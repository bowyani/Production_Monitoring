import mqtt, { type MqttClient } from "mqtt";

// Mock Protocol Gateway / Edge Adapter.
//
// A real PLC speaks Modbus, not MQTT — so it can't self-register or publish
// telemetry the way the simulator container does. The job that fills that gap
// is this box (README "ตัวกลางที่ต้องเพิ่มเข้ามา: Protocol Gateway"):
//
//   1. Register itself with the backend (a Gateway row).
//   2. Ask the backend which machines are bound to it
//      (GET /admin/gateways/:id/machines — the config an Admin typed in).
//   3. "Poll each PLC over Modbus" — here synthesised, no real RS-485 — and
//      republish the readings on the SAME MQTT topic + schema the simulator
//      uses (factory/<id>/telemetry|job|alarm), so nothing downstream of the
//      broker knows or cares that the source is a gateway and not a sim.
//   4. Heartbeat so the dashboard's Gateway Management page shows it ONLINE.
//
// There is deliberately no Modbus library here: the point of the prototype is
// the *shape* of the integration (poll -> cook -> publish under a known id),
// not a real fieldbus stack.

const GATEWAY_ID = process.env.GATEWAY_ID ?? "GW-01";
const GATEWAY_IP = process.env.GATEWAY_IP ?? "192.168.10.2";
const GATEWAY_LOCATION = process.env.GATEWAY_LOCATION ?? "Building A - Line 1";
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:3000/api/v1";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 10000);

// Demo convenience only: a real deployment has the machines registered by an
// Admin through the UI before the gateway ever runs. With this on, the
// gateway bootstraps a couple of ERP assets and manual-registers them to
// itself so `docker compose up` shows the Modbus path end-to-end with no
// clicks. Off => the gateway only publishes for machines someone else bound.
const SEED_DEMO_MACHINES = process.env.SEED_DEMO_MACHINES === "true";
const DEMO_MACHINE_IDS = (process.env.DEMO_MACHINE_IDS ?? "IMM-51,IMM-52")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PRODUCT_CODES = ["PVC-90-ELBOW", "PVC-110-TEE", "PVC-63-COUPLING"];

const ALARM_DEFS: { code: string; message: string }[] = [
  { code: "E001", message: "Barrel over-temperature" },
  { code: "E002", message: "Injection pressure out of range" },
  { code: "E004", message: "Low hydraulic oil pressure" },
  { code: "E005", message: "Screw motor overload" },
  { code: "E006", message: "Cooling water flow fault" },
];

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function round1(v: number) {
  return Math.round(v * 10) / 10;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type GatewayMachine = {
  machineId: string;
  connectionType: string;
  modbusSlaveId: number | null;
  modbusIp: string | null;
  modbusPort: number | null;
  registerMap: Record<string, number> | null;
  isActive: boolean;
  status: string;
};

// One machine's synthesised "register bank" + job bookkeeping. Stands in for
// the holding registers the gateway would actually be reading off a PLC.
type PolledMachine = {
  status: "RUN" | "STOP" | "ALARM";
  shotCount: number;
  cycleTimeSec: number;
  pressureBar: number;
  temperatureC: number;
  jobNumber: string | null;
  goodQty: number;
  rejectQty: number;
  goodShotsRemaining: number;
  alarmTicksRemaining: number;
  activeAlarmCode: string | null;
  jobCounter: number;
};

const banks = new Map<string, PolledMachine>();

function freshBank(): PolledMachine {
  return {
    status: "STOP",
    shotCount: 0,
    cycleTimeSec: 12,
    pressureBar: 850,
    temperatureC: 220,
    jobNumber: null,
    goodQty: 0,
    rejectQty: 0,
    goodShotsRemaining: 0,
    alarmTicksRemaining: 0,
    activeAlarmCode: null,
    jobCounter: 0,
  };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BACKEND_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Register (or touch) this gateway's own row. Retried because the backend may
// still be migrating when the container comes up.
async function bootstrapGateway() {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const res = await postJson(`/admin/gateways/${encodeURIComponent(GATEWAY_ID)}/bootstrap`, {
        ipAddress: GATEWAY_IP,
        location: GATEWAY_LOCATION,
      });
      if (res.ok) {
        console.log(`[${GATEWAY_ID}] gateway registered (status ${res.status})`);
        return;
      }
      console.warn(`[${GATEWAY_ID}] gateway bootstrap attempt ${attempt} -> ${res.status}`);
    } catch (err) {
      console.warn(`[${GATEWAY_ID}] gateway bootstrap attempt ${attempt} error: ${(err as Error).message}`);
    }
    await sleep(2000);
  }
  console.error(`[${GATEWAY_ID}] giving up on gateway bootstrap, continuing anyway`);
}

function mockRegisterMap(): Record<string, number> {
  // Holding-register-style addresses (4xxxx). Values are illustrative — the
  // backend never interprets them, they just show up in the config.
  return {
    status: 40001,
    cycle_time: 40002,
    injection_pressure: 40003,
    barrel_temperature: 40004,
    shot_count: 40005,
    good_qty: 40010,
    reject_qty: 40011,
  };
}

// Demo-only: create the ERP asset then manual-register the machine against
// this gateway, mirroring what an Admin would do in the UI. 409s are fine —
// it just means a previous run already did it.
async function seedDemoMachines() {
  for (let i = 0; i < DEMO_MACHINE_IDS.length; i++) {
    const machineId = DEMO_MACHINE_IDS[i];
    const slaveId = i + 1;
    try {
      const assetRes = await postJson(
        `/erp/machine-assets/${encodeURIComponent(machineId)}/bootstrap`,
        {
          machineName: `Injection Molding Machine ${machineId}`,
          machineModel: "Chen Hsong JM138-Ai",
          ratedPowerKw: 55,
          laborCostPerHour: 180,
          targetCycleTimeSec: 12,
          maintenanceIntervalHours: 500,
          vendorName: "Siam Molding Equipment",
          location: GATEWAY_LOCATION,
        }
      );
      if (!assetRes.ok && assetRes.status !== 409) {
        console.warn(`[${GATEWAY_ID}] ${machineId} ERP bootstrap -> ${assetRes.status}`);
      }

      const regRes = await postJson(`/admin/machines/manual-register`, {
        assetId: machineId,
        connectionType: "MODBUS_TCP",
        gatewayId: GATEWAY_ID,
        modbusSlaveId: slaveId,
        modbusIp: `192.168.10.${20 + i}`,
        modbusPort: 502,
        registerMap: mockRegisterMap(),
        createdBy: "mock-gateway",
      });
      if (regRes.ok || regRes.status === 409) {
        console.log(`[${GATEWAY_ID}] demo machine ${machineId} registered (status ${regRes.status})`);
      } else {
        console.warn(`[${GATEWAY_ID}] demo machine ${machineId} manual-register -> ${regRes.status}`);
      }
    } catch (err) {
      console.warn(`[${GATEWAY_ID}] seed ${machineId} error: ${(err as Error).message}`);
    }
  }
}

async function heartbeat() {
  try {
    const res = await postJson(`/admin/gateways/${encodeURIComponent(GATEWAY_ID)}/heartbeat`, {});
    if (!res.ok) console.warn(`[${GATEWAY_ID}] heartbeat -> ${res.status}`);
  } catch (err) {
    console.warn(`[${GATEWAY_ID}] heartbeat error: ${(err as Error).message}`);
  }
}

async function fetchAssignedMachines(): Promise<GatewayMachine[]> {
  try {
    const res = await fetch(`${BACKEND_API_URL}/admin/gateways/${encodeURIComponent(GATEWAY_ID)}/machines`);
    if (!res.ok) {
      console.warn(`[${GATEWAY_ID}] machine list -> ${res.status}`);
      return [];
    }
    return (await res.json()) as GatewayMachine[];
  } catch (err) {
    console.warn(`[${GATEWAY_ID}] machine list error: ${(err as Error).message}`);
    return [];
  }
}

function publishJSON(client: MqttClient, topic: string, payload: unknown) {
  client.publish(topic, JSON.stringify(payload));
}

// "Poll one PLC and cook its registers into a telemetry payload." Same job
// lifecycle (START -> UPDATE -> END) and alarm shape the simulator emits, so
// the backend subscriber accepts it with zero changes.
function pollMachine(client: MqttClient, machineId: string) {
  let bank = banks.get(machineId);
  if (!bank) {
    bank = freshBank();
    banks.set(machineId, bank);
  }
  const now = new Date().toISOString();

  // Alarm lifecycle.
  if (bank.alarmTicksRemaining > 0) {
    bank.alarmTicksRemaining -= 1;
    if (bank.alarmTicksRemaining === 0) {
      publishJSON(client, `factory/${machineId}/alarm`, {
        schemaVersion: "1.0",
        machineId,
        timestamp: now,
        alarmData: {
          event: "CLEAR",
          alarmCode: bank.activeAlarmCode ?? "E001",
          jobNumber: bank.jobNumber ?? undefined,
        },
      });
      bank.activeAlarmCode = null;
      bank.status = "RUN";
    }
  } else if (bank.status === "RUN" && Math.random() < 0.02) {
    const def = ALARM_DEFS[Math.floor(Math.random() * ALARM_DEFS.length)];
    bank.status = "ALARM";
    bank.alarmTicksRemaining = 3 + Math.floor(Math.random() * 4);
    bank.activeAlarmCode = def.code;
    if (def.code === "E001" || def.code === "E006") bank.temperatureC += 12;
    if (def.code === "E002") bank.pressureBar += 150;
    publishJSON(client, `factory/${machineId}/alarm`, {
      schemaVersion: "1.0",
      machineId,
      timestamp: now,
      alarmData: {
        event: "RAISE",
        alarmCode: def.code,
        alarmMessage: def.message,
        jobNumber: bank.jobNumber ?? undefined,
      },
    });
  }

  // Job lifecycle.
  if (!bank.jobNumber && bank.status !== "ALARM") {
    bank.jobCounter += 1;
    bank.jobNumber = `JOB-${machineId}-${Date.now()}-${bank.jobCounter}`;
    bank.goodQty = 0;
    bank.rejectQty = 0;
    bank.goodShotsRemaining = 30 + Math.floor(Math.random() * 40);
    bank.status = "RUN";
    publishJSON(client, `factory/${machineId}/job`, {
      schemaVersion: "1.0",
      machineId,
      timestamp: now,
      jobData: {
        jobNumber: bank.jobNumber,
        event: "START",
        productCode: PRODUCT_CODES[Math.floor(Math.random() * PRODUCT_CODES.length)],
        moldId: `MOLD-${1 + Math.floor(Math.random() * 5)}`,
        recipeId: `RECIPE-${1 + Math.floor(Math.random() * 5)}`,
        plannedQty: bank.goodShotsRemaining,
      },
    });
  } else if (bank.jobNumber && bank.status === "RUN") {
    if (Math.random() < 0.03) {
      bank.rejectQty += 1;
    } else {
      bank.goodQty += 1;
      bank.goodShotsRemaining -= 1;
    }
    bank.shotCount += 1;
    publishJSON(client, `factory/${machineId}/job`, {
      schemaVersion: "1.0",
      machineId,
      timestamp: now,
      jobData: {
        jobNumber: bank.jobNumber,
        event: "UPDATE",
        goodQty: bank.goodQty,
        rejectQty: bank.rejectQty,
        startupScrapQty: 0,
      },
    });
    if (bank.goodShotsRemaining <= 0) {
      publishJSON(client, `factory/${machineId}/job`, {
        schemaVersion: "1.0",
        machineId,
        timestamp: now,
        jobData: {
          jobNumber: bank.jobNumber,
          event: "END",
          goodQty: bank.goodQty,
          rejectQty: bank.rejectQty,
          startupScrapQty: 0,
        },
      });
      bank.jobNumber = null;
      bank.status = "STOP";
    }
  }

  // Analog "register" drift.
  bank.cycleTimeSec = clamp(bank.cycleTimeSec + (Math.random() - 0.5) * 0.4, 9, 16);
  bank.pressureBar = clamp(bank.pressureBar + (Math.random() - 0.5) * 20, 700, 950);
  bank.temperatureC = clamp(
    bank.temperatureC + (Math.random() - 0.5) * 2 - (bank.temperatureC > 230 ? 3 : 0),
    195,
    245
  );

  publishJSON(client, `factory/${machineId}/telemetry`, {
    schemaVersion: "1.0",
    machineId,
    timestamp: now,
    machineData: { status: bank.status },
    processData: {
      cycleTimeSec: round1(bank.cycleTimeSec),
      shotCount: bank.shotCount,
      injectionPressureBar: round1(bank.pressureBar),
      barrelTemperatureC: round1(bank.temperatureC),
    },
  });
}

async function main() {
  await bootstrapGateway();
  if (SEED_DEMO_MACHINES) await seedDemoMachines();

  const client = mqtt.connect(MQTT_BROKER_URL);
  client.on("connect", () => console.log(`[${GATEWAY_ID}] mqtt connected to ${MQTT_BROKER_URL}`));
  client.on("error", (err) => console.error(`[${GATEWAY_ID}] mqtt error`, err));

  await heartbeat();
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  // Refreshed every poll so a machine registered/activated/deactivated in the
  // UI is picked up without restarting the gateway.
  setInterval(async () => {
    const machines = await fetchAssignedMachines();
    const activeIds = new Set(machines.filter((m) => m.isActive).map((m) => m.machineId));
    for (const id of activeIds) pollMachine(client, id);
    // Drop bookkeeping for machines no longer ours.
    for (const id of [...banks.keys()]) if (!activeIds.has(id)) banks.delete(id);
  }, POLL_INTERVAL_MS);

  console.log(
    `[${GATEWAY_ID}] polling every ${POLL_INTERVAL_MS}ms, heartbeat every ${HEARTBEAT_INTERVAL_MS}ms`
  );
}

main();
