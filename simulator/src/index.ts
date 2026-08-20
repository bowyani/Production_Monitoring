import mqtt, { type MqttClient } from "mqtt";

const MACHINE_ID = process.env.MACHINE_ID ?? "IMM-01";
const MACHINE_NAME = process.env.MACHINE_NAME ?? `Injection Molding Machine ${MACHINE_ID}`;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:3000/api/v1";
const TICK_MS = 2000;

const PRODUCT_CODES = ["PVC-90-ELBOW", "PVC-110-TEE", "PVC-63-COUPLING"];

type MachineState = {
  status: "RUN" | "STOP" | "ALARM";
  shotCount: number;
  cycleTimeSec: number;
  pressureBar: number;
  temperatureC: number;
  jobNumber: string | null;
  goodQty: number;
  rejectQty: number;
  startupScrapQty: number;
  jobShotsRemaining: number;
  silentTicksRemaining: number;
  alarmTicksRemaining: number;
};

const state: MachineState = {
  status: "STOP",
  shotCount: 0,
  cycleTimeSec: 12,
  pressureBar: 850,
  temperatureC: 220,
  jobNumber: null,
  goodQty: 0,
  rejectQty: 0,
  startupScrapQty: 0,
  jobShotsRemaining: 0,
  silentTicksRemaining: 0,
  alarmTicksRemaining: 0,
};

let jobCounter = 0;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function publishJSON(client: MqttClient, topic: string, payload: unknown) {
  client.publish(topic, JSON.stringify(payload));
}

// Registers via the Admin API (the legitimate registration channel — see
// README.md, "Design Rationale" section) so `docker compose up` produces a working demo
// without a manual Admin UI step first. The MQTT ingestion path still
// rejects telemetry from any machineId that isn't registered.
async function registerMachine() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const res = await fetch(`${BACKEND_API_URL}/admin/machines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: MACHINE_ID,
          machineName: MACHINE_NAME,
          createdBy: "simulator-bootstrap",
        }),
      });
      if (res.ok || res.status === 409) {
        console.log(`[${MACHINE_ID}] registered (status ${res.status})`);
        return;
      }
      console.warn(`[${MACHINE_ID}] registration attempt ${attempt} failed: ${res.status}`);
    } catch (err) {
      console.warn(`[${MACHINE_ID}] registration attempt ${attempt} error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`[${MACHINE_ID}] giving up on registration after retries, publishing anyway`);
}

function startJob() {
  jobCounter += 1;
  state.jobNumber = `JOB-${MACHINE_ID}-${Date.now()}-${jobCounter}`;
  state.goodQty = 0;
  state.rejectQty = 0;
  // First few shots after a mold/job change are purge scrap, not reject —
  // see README.md, "Gap Analysis" §1.2.
  state.startupScrapQty = 3;
  state.jobShotsRemaining = 30 + Math.floor(Math.random() * 40);
  state.status = "RUN";
  return {
    productCode: PRODUCT_CODES[Math.floor(Math.random() * PRODUCT_CODES.length)],
    moldId: `MOLD-${1 + Math.floor(Math.random() * 5)}`,
    recipeId: `RECIPE-${1 + Math.floor(Math.random() * 5)}`,
  };
}

function tick(client: MqttClient) {
  const now = new Date().toISOString();

  // Occasionally stop publishing entirely, without disconnecting from MQTT —
  // this is what the backend watchdog (not MQTT LWT) is designed to catch.
  // See README.md, "Design Rationale" section.
  if (state.silentTicksRemaining > 0) {
    state.silentTicksRemaining -= 1;
    return;
  }
  if (state.status !== "ALARM" && Math.random() < 0.01) {
    state.silentTicksRemaining = 5 + Math.floor(Math.random() * 5);
    console.log(`[${MACHINE_ID}] going silent for ${state.silentTicksRemaining} ticks`);
    return;
  }

  if (state.alarmTicksRemaining > 0) {
    state.alarmTicksRemaining -= 1;
    if (state.alarmTicksRemaining === 0) {
      state.status = "RUN";
      publishJSON(client, `factory/${MACHINE_ID}/alarm`, {
        schemaVersion: "1.0",
        machineId: MACHINE_ID,
        timestamp: now,
        alarmData: { event: "CLEAR", alarmCode: "E001", jobNumber: state.jobNumber ?? undefined },
      });
    }
  } else if (state.status === "RUN" && Math.random() < 0.015) {
    state.status = "ALARM";
    state.alarmTicksRemaining = 3 + Math.floor(Math.random() * 4);
    state.temperatureC += 15;
    publishJSON(client, `factory/${MACHINE_ID}/alarm`, {
      schemaVersion: "1.0",
      machineId: MACHINE_ID,
      timestamp: now,
      alarmData: {
        event: "RAISE",
        alarmCode: "E001",
        alarmMessage: "Barrel over-temperature",
        jobNumber: state.jobNumber ?? undefined,
      },
    });
  }

  if (!state.jobNumber && state.status !== "ALARM") {
    const jobData = startJob();
    publishJSON(client, `factory/${MACHINE_ID}/job`, {
      schemaVersion: "1.0",
      machineId: MACHINE_ID,
      timestamp: now,
      jobData: { jobNumber: state.jobNumber, event: "START", ...jobData },
    });
  } else if (state.jobNumber && state.status === "RUN") {
    if (state.startupScrapQty > 0) {
      state.startupScrapQty -= 1;
    } else if (Math.random() < 0.03) {
      state.rejectQty += 1;
    } else {
      state.goodQty += 1;
    }
    state.shotCount += 1;
    state.jobShotsRemaining -= 1;

    publishJSON(client, `factory/${MACHINE_ID}/job`, {
      schemaVersion: "1.0",
      machineId: MACHINE_ID,
      timestamp: now,
      jobData: {
        jobNumber: state.jobNumber,
        event: "UPDATE",
        goodQty: state.goodQty,
        rejectQty: state.rejectQty,
        startupScrapQty: state.startupScrapQty,
      },
    });

    if (state.jobShotsRemaining <= 0) {
      publishJSON(client, `factory/${MACHINE_ID}/job`, {
        schemaVersion: "1.0",
        machineId: MACHINE_ID,
        timestamp: now,
        jobData: {
          jobNumber: state.jobNumber,
          event: "END",
          goodQty: state.goodQty,
          rejectQty: state.rejectQty,
          startupScrapQty: state.startupScrapQty,
        },
      });
      state.jobNumber = null;
      state.status = "STOP";
    }
  }

  state.cycleTimeSec = clamp(state.cycleTimeSec + (Math.random() - 0.5) * 0.4, 9, 16);
  state.pressureBar = clamp(state.pressureBar + (Math.random() - 0.5) * 20, 700, 950);
  state.temperatureC = clamp(
    state.temperatureC + (Math.random() - 0.5) * 2 - (state.temperatureC > 230 ? 3 : 0),
    195,
    245
  );

  publishJSON(client, `factory/${MACHINE_ID}/telemetry`, {
    schemaVersion: "1.0",
    machineId: MACHINE_ID,
    timestamp: now,
    machineData: { status: state.status },
    processData: {
      cycleTimeSec: round1(state.cycleTimeSec),
      shotCount: state.shotCount,
      injectionPressureBar: round1(state.pressureBar),
      barrelTemperatureC: round1(state.temperatureC),
    },
  });
}

async function main() {
  await registerMachine();

  const client = mqtt.connect(MQTT_BROKER_URL);
  client.on("connect", () => console.log(`[${MACHINE_ID}] mqtt connected to ${MQTT_BROKER_URL}`));
  client.on("error", (err) => console.error(`[${MACHINE_ID}] mqtt error`, err));

  setInterval(() => tick(client), TICK_MS);
}

main();
