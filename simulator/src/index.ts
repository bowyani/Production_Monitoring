import mqtt, { type MqttClient } from "mqtt";

const MACHINE_ID = process.env.MACHINE_ID ?? "IMM-01";
const MACHINE_NAME = process.env.MACHINE_NAME ?? `Injection Molding Machine ${MACHINE_ID}`;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:3000/api/v1";

const PRODUCT_CODES = ["PVC-90-ELBOW", "PVC-110-TEE", "PVC-63-COUPLING"];

// Every probability/range below used to be a hardcoded magic number sprinkled
// through tick(). They're pulled out here so the dashboard's Simulator Tuning
// page (backend/src/api/simulatorControl.ts) can adjust them live over MQTT
// without a container restart — see the control-topic handling in main().
type Tuning = {
  tickMs: number;
  silentProbability: number;
  alarmProbability: number;
  rejectProbability: number;
  cycleTimeMinSec: number;
  cycleTimeMaxSec: number;
  pressureMinBar: number;
  pressureMaxBar: number;
  temperatureMinC: number;
  temperatureMaxC: number;
  // Shots after a mold/job change treated as purge scrap, not reject. Mirrors
  // ErpMachineAsset.startupScrapQty — ERP pushes changes here live over this
  // same control channel (see backend/src/api/erp.ts, admin.ts).
  startupScrapQty: number;
};

const DEFAULT_TUNING: Tuning = {
  tickMs: 2000,
  silentProbability: 0.2,
  alarmProbability: 0.015,
  rejectProbability: 0.03,
  cycleTimeMinSec: 9,
  cycleTimeMaxSec: 16,
  pressureMinBar: 700,
  pressureMaxBar: 950,
  temperatureMinC: 195,
  temperatureMaxC: 245,
  startupScrapQty: 3,
};

let tuning: Tuning = { ...DEFAULT_TUNING };

const CONTROL_TOPIC = `factory/${MACHINE_ID}/control`;
const CONTROL_STATE_TOPIC = `factory/${MACHINE_ID}/control/state`;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Applies only the well-formed fields from an untrusted MQTT payload, and
// keeps min <= max on paired range fields so a bad value from the UI can't
// wedge tick()'s clamp() calls into an inverted, always-out-of-range state.
function applyTuningPatch(patch: Record<string, unknown>) {
  const next: Tuning = { ...tuning };
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
    const v = patch[key];
    if (isFiniteNumber(v)) next[key] = v;
  }
  if (next.cycleTimeMinSec > next.cycleTimeMaxSec) {
    [next.cycleTimeMinSec, next.cycleTimeMaxSec] = [next.cycleTimeMaxSec, next.cycleTimeMinSec];
  }
  if (next.pressureMinBar > next.pressureMaxBar) {
    [next.pressureMinBar, next.pressureMaxBar] = [next.pressureMaxBar, next.pressureMinBar];
  }
  if (next.temperatureMinC > next.temperatureMaxC) {
    [next.temperatureMinC, next.temperatureMaxC] = [next.temperatureMaxC, next.temperatureMinC];
  }
  next.tickMs = clamp(next.tickMs, 200, 10000);
  tuning = next;
}

function publishTuningState(client: MqttClient) {
  // Retained so a dashboard opened after the fact (or a backend restart)
  // still sees the current values instead of "unknown".
  client.publish(CONTROL_STATE_TOPIC, JSON.stringify({ machineId: MACHINE_ID, tuning }), { retain: true });
}

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
  activeAlarmCode: string | null;
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
  activeAlarmCode: null,
};

// Realistic Injection Molding fault set, not just barrel over-temperature.
// `apply` nudges telemetry toward whatever symptom that fault would actually
// produce, so History/KPI views showing a temperature or pressure spike line
// up with the alarm that was raised at the same moment.
type AlarmDef = { code: string; message: string; apply: () => void };
const ALARM_DEFS: AlarmDef[] = [
  { code: "E001", message: "Barrel over-temperature", apply: () => { state.temperatureC += 15; } },
  { code: "E002", message: "Injection pressure out of range", apply: () => { state.pressureBar += 180; } },
  { code: "E003", message: "Mold not fully closed", apply: () => {} },
  { code: "E004", message: "Low hydraulic oil pressure", apply: () => { state.pressureBar = clamp(state.pressureBar - 200, 700, 950); } },
  { code: "E005", message: "Screw motor overload", apply: () => { state.cycleTimeSec += 6; } },
  { code: "E006", message: "Cooling water flow fault", apply: () => { state.temperatureC += 8; } },
  { code: "E007", message: "Material hopper low", apply: () => {} },
  { code: "E008", message: "Ejector fault", apply: () => {} },
];

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

const MOCK_MODELS = ["Haitian MA1200", "Haitian MA2000", "ENGEL e-motion 310", "Arburg Allrounder 470 A", "Chen Hsong JM138-Ai"];
const MOCK_VENDORS = ["Thai Plastic Machinery Co.", "Asia Injection Systems Ltd.", "Siam Molding Equipment"];
const MOCK_LOCATIONS = ["Building A", "Building B", "Building C"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic per-machine mock ERP specs — same MACHINE_ID always yields
// the same values, so re-bootstrapping a known machine never shuffles its
// "master data" around. Only used the very first time an asset is created
// (see registerMachine) so it doesn't fight an admin's later ERP edits.
//
// Each field hashes MACHINE_ID salted with its own field name rather than
// sharing one hash across fields — two fields whose pick-lists happen to be
// the same length (e.g. MOCK_VENDORS/MOCK_LOCATIONS, both 3 entries) would
// otherwise always land on the same index and vary in lock-step for every
// machine (every "Building A" machine getting the same vendor, etc.).
function buildMockAssetDefaults(machineId: string) {
  const h = (field: string) => hashString(`${machineId}:${field}`);
  const purchaseDate = new Date();
  purchaseDate.setFullYear(purchaseDate.getFullYear() - (1 + (h("purchaseYear") % 5)));
  return {
    machineModel: MOCK_MODELS[h("model") % MOCK_MODELS.length],
    ratedPowerKw: 30 + (h("ratedPower") % 40),
    laborCostPerHour: 150 + (h("laborCost") % 150),
    targetCycleTimeSec: 10 + (h("cycleTime") % 6),
    maintenanceIntervalHours: 400 + (h("maintenance") % 5) * 100,
    vendorName: MOCK_VENDORS[h("vendor") % MOCK_VENDORS.length],
    purchaseDate: purchaseDate.toISOString().slice(0, 10),
    location: MOCK_LOCATIONS[h("location") % MOCK_LOCATIONS.length],
    manufacturerPhone: `02-${String(100 + (h("phone1") % 900)).padStart(3, "0")}-${String(1000 + (h("phone2") % 9000)).padStart(4, "0")}`,
  };
}

// Registers via the Admin API (the legitimate registration channel — see
// README.md, "Design Rationale" section) so `docker compose up` produces a working demo
// without a manual Admin UI step first. The MQTT ingestion path still
// rejects telemetry from any machineId that isn't registered.
//
// Admin no longer accepts machine specs as free text (it picks an existing
// ERP asset — see backend/src/api/admin.ts), so a simulator bootstrapping
// itself for the first time has to seed its own ERP asset record too. A real
// deployment would already have that asset in ERP before commissioning; this
// stands in for that step so `docker compose up` stays a one-command demo.
async function registerMachine() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const existingRes = await fetch(`${BACKEND_API_URL}/erp/machine-assets`);
      if (!existingRes.ok) {
        console.warn(`[${MACHINE_ID}] ERP asset lookup attempt ${attempt} failed: ${existingRes.status}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const existingAssets = (await existingRes.json()) as { assetId: string }[];
      const alreadyExists = existingAssets.some((a) => a.assetId === MACHINE_ID);

      // First-ever boot: seed realistic-looking specs so the demo isn't full
      // of blank machine assets. Once the asset exists, touch only
      // machineName — an admin may have hand-edited the rest since.
      const assetBody = alreadyExists
        ? { machineName: MACHINE_NAME }
        : { machineName: MACHINE_NAME, ...buildMockAssetDefaults(MACHINE_ID) };

      const assetRes = await fetch(`${BACKEND_API_URL}/erp/machine-assets/${encodeURIComponent(MACHINE_ID)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetBody),
      });
      if (!assetRes.ok) {
        console.warn(`[${MACHINE_ID}] ERP asset upsert attempt ${attempt} failed: ${assetRes.status}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const res = await fetch(`${BACKEND_API_URL}/admin/machines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: MACHINE_ID,
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
  state.startupScrapQty = tuning.startupScrapQty;
  state.jobShotsRemaining = 30 + Math.floor(Math.random() * 40);
  state.status = "RUN";
  return {
    productCode: PRODUCT_CODES[Math.floor(Math.random() * PRODUCT_CODES.length)],
    moldId: `MOLD-${1 + Math.floor(Math.random() * 5)}`,
    recipeId: `RECIPE-${1 + Math.floor(Math.random() * 5)}`,
    plannedQty: state.jobShotsRemaining,
  };
}

function tick(client: MqttClient) {
  const now = new Date().toISOString();

  // Occasionally stop publishing entirely, without disconnecting from MQTT —
  // this is what the backend watchdog (not MQTT LWT) is designed to catch.
  // See README.md, "Design Rationale" section. Raised from the originally
  // realistic 1% to 20% so OFFLINE actually shows up during a demo instead
  // of needing a long wait for bad luck.
  if (state.silentTicksRemaining > 0) {
    state.silentTicksRemaining -= 1;
    return;
  }
  if (state.status !== "ALARM" && Math.random() < tuning.silentProbability) {
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
        alarmData: {
          event: "CLEAR",
          alarmCode: state.activeAlarmCode ?? "E001",
          jobNumber: state.jobNumber ?? undefined,
        },
      });
      state.activeAlarmCode = null;
    }
  } else if (state.status === "RUN" && Math.random() < tuning.alarmProbability) {
    const def = ALARM_DEFS[Math.floor(Math.random() * ALARM_DEFS.length)];
    state.status = "ALARM";
    state.alarmTicksRemaining = 3 + Math.floor(Math.random() * 4);
    state.activeAlarmCode = def.code;
    def.apply();
    publishJSON(client, `factory/${MACHINE_ID}/alarm`, {
      schemaVersion: "1.0",
      machineId: MACHINE_ID,
      timestamp: now,
      alarmData: {
        event: "RAISE",
        alarmCode: def.code,
        alarmMessage: def.message,
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
    } else if (Math.random() < tuning.rejectProbability) {
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

  state.cycleTimeSec = clamp(
    state.cycleTimeSec + (Math.random() - 0.5) * 0.4,
    tuning.cycleTimeMinSec,
    tuning.cycleTimeMaxSec
  );
  state.pressureBar = clamp(
    state.pressureBar + (Math.random() - 0.5) * 20,
    tuning.pressureMinBar,
    tuning.pressureMaxBar
  );
  state.temperatureC = clamp(
    state.temperatureC + (Math.random() - 0.5) * 2 - (state.temperatureC > 230 ? 3 : 0),
    tuning.temperatureMinC,
    tuning.temperatureMaxC
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

  let tickHandle: ReturnType<typeof setInterval> | undefined;
  function rescheduleTick() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(() => tick(client), tuning.tickMs);
  }

  client.on("connect", () => {
    console.log(`[${MACHINE_ID}] mqtt connected to ${MQTT_BROKER_URL}`);
    client.subscribe(CONTROL_TOPIC);
    publishTuningState(client);
    rescheduleTick();
  });
  client.on("error", (err) => console.error(`[${MACHINE_ID}] mqtt error`, err));

  // Live fine-tuning channel: the dashboard's Simulator Tuning page patches
  // this machine's probabilities/ranges without a restart. See
  // dashboard/src/pages/SimulatorTuningView.tsx and
  // backend/src/api/simulatorControl.ts.
  client.on("message", (topic, payload) => {
    if (topic !== CONTROL_TOPIC) return;
    try {
      const patch = JSON.parse(payload.toString());
      const previousTickMs = tuning.tickMs;
      applyTuningPatch(patch);
      console.log(`[${MACHINE_ID}] tuning updated`, tuning);
      publishTuningState(client);
      if (tuning.tickMs !== previousTickMs) rescheduleTick();
    } catch (err) {
      console.warn(`[${MACHINE_ID}] rejected control message`, err);
    }
  });
}

main();
