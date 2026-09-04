// A tiny injection-molding simulation that runs entirely in the browser for the
// VITE_MOCK build. It pre-seeds a few hours of history on load, then ticks every
// 2s; mockApi.ts reads its state and mockSocket.ts forwards its events.
import { PRODUCT_CODES, MACHINE_ASSETS, MACHINE_START } from "./fixtures";

export type MockTelemetry = {
  id: string;
  machineId: string;
  timestamp: string;
  status: string;
  cycleTimeSec: number;
  shotCount: number;
  injectionPressureBar: number;
  barrelTemperatureC: number;
};

export type MockStatusEvent = {
  id: string;
  machineId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
};

export type MockAlarm = {
  id: string;
  machineId: string;
  jobNumber: string | null;
  alarmCode: string;
  alarmMessage: string;
  alarmTimestamp: string;
  clearedTimestamp: string | null;
};

export type MockJob = {
  jobNumber: string;
  machineId: string;
  productCode: string;
  moldId: string;
  recipeId: string;
  startTime: string;
  endTime: string | null;
  goodQty: number;
  rejectQty: number;
  startupScrapQty: number;
  status: "RUNNING" | "COMPLETED";
  orderedQty: number;
};

export type LiveEvent =
  | { event: "telemetry"; data: Record<string, unknown> }
  | { event: "status"; data: { machineId: string; status: string } }
  | { event: "alarm"; data: { machineId: string; alarmCode: string; event: string } }
  | { event: "job"; data: { machineId: string; jobNumber: string; event: string } };

const ALARM_CODES = [
  ["E-102", "Hydraulic oil temperature high"],
  ["E-210", "Mold clamp force out of tolerance"],
  ["E-045", "Barrel zone 2 heater fault"],
  ["E-330", "Ejector position sensor timeout"],
  ["E-118", "Injection pressure spike"],
];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
let seq = 0;
const nextId = () => `mck-${(++seq).toString(36)}-${Date.now().toString(36)}`;

type M = {
  id: string;
  status: string;
  statusSince: number;
  cycleTimeSec: number;
  shotCount: number;
  pressureBar: number;
  temperatureC: number;
  lastMaintenanceAt: string;
  targetCycle: number;
  job: MockJob;
  ticksInState: number;
};

const PRESEED_SPAN_MS = 4 * 3_600_000;

class Engine {
  machines: Record<string, M> = {};
  telemetry: MockTelemetry[] = [];
  statusEvents: MockStatusEvent[] = [];
  jobs: MockJob[] = [];
  alarms: MockAlarm[] = [];
  bootAt = Date.now();
  private jobCounter = 0;
  private subs = new Set<(e: LiveEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private persistEvery = 5; // keep 1 telemetry row per 5 ticks (~10s)
  private tickN = 0;

  constructor() {
    for (const a of MACHINE_ASSETS) {
      const start = MACHINE_START[a.assetId] ?? { status: "RUN", lastMaintenanceAgoH: 200 };
      const target = a.targetCycleTimeSec ?? 13;
      this.machines[a.assetId] = {
        id: a.assetId,
        status: start.status,
        statusSince: this.bootAt,
        cycleTimeSec: target + rnd(-1, 2),
        shotCount: Math.floor(rnd(4000, 40000)),
        pressureBar: rnd(760, 900),
        temperatureC: rnd(205, 235),
        lastMaintenanceAt: new Date(this.bootAt - start.lastMaintenanceAgoH * 3_600_000).toISOString(),
        targetCycle: target,
        ticksInState: 0,
        // First job starts at the beginning of the pre-seeded history, not
        // "now", so history and KPI windows over today actually contain jobs.
        job: this.freshJob(a.assetId, this.bootAt - PRESEED_SPAN_MS),
      };
    }
  }

  private started = false;
  // Called once from mockApi.ts, only in the VITE_MOCK build — the real-backend
  // build imports this module but must never pay the preseed/interval cost.
  init() {
    if (this.started) return;
    this.started = true;
    this.preseed();
    this.start();
  }

  private freshJob(machineId: string, at: number): MockJob {
    this.jobCounter += 1;
    const productCode = pick(PRODUCT_CODES);
    return {
      jobNumber: `JOB-${machineId}-${this.jobCounter.toString().padStart(4, "0")}`,
      machineId,
      productCode,
      moldId: `MOLD-${productCode.split("-")[1]}`,
      recipeId: `R-${Math.floor(rnd(10, 99))}`,
      startTime: new Date(at).toISOString(),
      endTime: null,
      goodQty: 0,
      rejectQty: 0,
      startupScrapQty: 0,
      status: "RUNNING",
      // Small orders so several jobs complete within the pre-seeded window and
      // the Production / KPI pages have a populated history.
      orderedQty: Math.floor(rnd(120, 420)),
    };
  }

  // Replay ~4h of history so every page has something on first paint.
  private preseed() {
    const span = PRESEED_SPAN_MS;
    const step = 10_000;
    for (let t = this.bootAt - span; t < this.bootAt; t += step) {
      for (const m of Object.values(this.machines)) this.step(m, t, true);
    }
  }

  private raiseAlarm(m: M, at: number) {
    const [code, msg] = pick(ALARM_CODES);
    this.alarms.push({
      id: nextId(),
      machineId: m.id,
      jobNumber: m.job.jobNumber,
      alarmCode: code,
      alarmMessage: msg,
      alarmTimestamp: new Date(at).toISOString(),
      clearedTimestamp: null,
    });
  }

  private clearAlarms(machineId: string, at: number) {
    for (const a of this.alarms)
      if (a.machineId === machineId && !a.clearedTimestamp) a.clearedTimestamp = new Date(at).toISOString();
  }

  private setStatus(m: M, to: string, at: number, live: boolean) {
    if (m.status === to) return;
    const from = m.status;
    m.status = to;
    m.statusSince = at;
    m.ticksInState = 0;
    this.statusEvents.push({
      id: nextId(),
      machineId: m.id,
      fromStatus: from,
      toStatus: to,
      changedAt: new Date(at).toISOString(),
    });
    if (to === "ALARM") this.raiseAlarm(m, at);
    if (from === "ALARM") this.clearAlarms(m.id, at);
    if (live) {
      this.emit({ event: "status", data: { machineId: m.id, status: to } });
      if (to === "ALARM")
        this.emit({ event: "alarm", data: { machineId: m.id, alarmCode: "raised", event: "raised" } });
    }
  }

  // One simulation step for a machine at time `t`. `live` gates event emission
  // and history thinning (preseed keeps every step).
  private step(m: M, t: number, preseed = false) {
    m.ticksInState += 1;

    // --- status machine -------------------------------------------------
    if (m.status === "RUN") {
      if (Math.random() < 0.006) this.setStatus(m, "ALARM", t, !preseed);
      else if (Math.random() < 0.01) this.setStatus(m, "STOP", t, !preseed);
      else if (Math.random() < 0.0015) this.setStatus(m, "OFFLINE", t, !preseed);
    } else if (m.status === "STOP" && m.ticksInState > rnd(3, 25)) {
      this.setStatus(m, "RUN", t, !preseed);
    } else if (m.status === "ALARM" && m.ticksInState > rnd(4, 18)) {
      this.setStatus(m, "RUN", t, !preseed);
    } else if (m.status === "OFFLINE" && m.ticksInState > rnd(5, 20)) {
      this.setStatus(m, "RUN", t, !preseed);
    }

    // --- process values ----------------------------------------------------
    const running = m.status === "RUN";
    m.cycleTimeSec = clamp(m.cycleTimeSec + rnd(-0.4, 0.4), m.targetCycle - 2, m.targetCycle + 5);
    m.pressureBar = clamp(
      m.pressureBar + rnd(-14, 14) + (m.status === "ALARM" ? 40 : 0),
      680,
      m.status === "ALARM" ? 1050 : 960
    );
    m.temperatureC = clamp(m.temperatureC + rnd(-2.2, 2.2), 190, 250);

    if (running) {
      m.shotCount += 1;
      const startupScrap = m.job.startupScrapQty < 3 && m.job.goodQty + m.job.rejectQty < 3;
      if (startupScrap) m.job.startupScrapQty += 1;
      else if (Math.random() < 0.03) m.job.rejectQty += 1;
      else m.job.goodQty += 1;

      if (m.job.goodQty >= m.job.orderedQty) {
        m.job.status = "COMPLETED";
        m.job.endTime = new Date(t).toISOString();
        this.jobs.push(m.job);
        m.job = this.freshJob(m.id, t);
        if (!preseed)
          this.emit({ event: "job", data: { machineId: m.id, jobNumber: m.job.jobNumber, event: "started" } });
      }
    }

    // --- record ----------------------------------------------------------
    const point: MockTelemetry = {
      id: nextId(),
      machineId: m.id,
      timestamp: new Date(t).toISOString(),
      status: m.status,
      cycleTimeSec: round1(m.cycleTimeSec),
      shotCount: m.shotCount,
      injectionPressureBar: round1(m.pressureBar),
      barrelTemperatureC: round1(m.temperatureC),
    };
    if (preseed || this.tickN % this.persistEvery === 0) this.telemetry.push(point);
    if (!preseed) this.emit({ event: "telemetry", data: point as unknown as Record<string, unknown> });
  }

  private prune() {
    const floor = Date.now() - 5 * 3_600_000;
    if (this.telemetry.length > 6000) this.telemetry = this.telemetry.filter((p) => +new Date(p.timestamp) > floor);
    if (this.statusEvents.length > 1500)
      this.statusEvents = this.statusEvents.filter((e) => +new Date(e.changedAt) > floor);
    if (this.alarms.length > 800)
      this.alarms = this.alarms.filter((a) => !a.clearedTimestamp || +new Date(a.alarmTimestamp) > floor);
    if (this.jobs.length > 400) this.jobs = this.jobs.slice(-400);
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tickN += 1;
      const t = Date.now();
      for (const m of Object.values(this.machines)) this.step(m, t);
      if (this.tickN % 30 === 0) this.prune();
    }, 2000);
  }

  subscribe(cb: (e: LiveEvent) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit(e: LiveEvent) {
    for (const cb of this.subs) {
      try {
        cb(e);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  // current job per machine, for listings
  currentJobs(): MockJob[] {
    return Object.values(this.machines).map((m) => m.job);
  }

  allJobs(): MockJob[] {
    return [...this.jobs, ...this.currentJobs()];
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export const engine = new Engine();
