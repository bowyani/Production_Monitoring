// Fake backend for the VITE_MOCK build: every read is answered from engine.ts,
// every write pops the "run it locally" dialog. Shapes mirror lib/api.ts.
import type {
  Api,
  Alarm,
  AuditLogEntry,
  ErpMachineAsset,
  ErpJobOrder,
  ErpRollup,
  ErpSummary,
  Gateway,
  KpiSummary,
  Machine,
  MachineKpi,
  MaintenanceOverview,
  ProductionJob,
  ProductSku,
  SimulatorTuning,
  StatusEvent,
  SystemStats,
  TelemetryPoint,
} from "../api";
import { SIMULATOR_DEFAULT_TUNING } from "../api";
import { MOCK, DemoLockedError, notifyDemoLocked } from "../demo";
import { MACHINE_ASSETS, SKUS, GATEWAYS } from "./fixtures";
import { engine, type MockJob, type MockTelemetry } from "./engine";

if (MOCK) engine.init();

const HOUR = 3_600_000;
const nowIso = () => new Date().toISOString();

function locked(): Promise<never> {
  notifyDemoLocked();
  return Promise.reject(new DemoLockedError());
}
function lockedResponse(): Promise<Response> {
  notifyDemoLocked();
  return Promise.resolve(
    new Response(JSON.stringify({ error: "READ_ONLY_DEMO" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function windowOf(from?: string, to?: string) {
  const toMs = to ? +new Date(to) : Date.now();
  const fromMs = from ? +new Date(from) : toMs - 24 * HOUR;
  return { fromMs, toMs, hours: Math.max((toMs - fromMs) / HOUR, 0.01) };
}

const asset = (id: string) => MACHINE_ASSETS.find((a) => a.assetId === id);
const sku = (code: string) => SKUS.find((s) => s.productCode === code);

function machineOf(id: string): Machine {
  const a = asset(id)!;
  const m = engine.machines[id];
  const runHours = hoursSinceMaintenance(id);
  return {
    machineId: id,
    machineName: a.machineName,
    machineModel: a.machineModel,
    status: m.status,
    lastSeenAt: nowIso(),
    lastImportedAt: null,
    isActive: true,
    dataSource: "SIMULATOR",
    connectionType: "SIMULATOR",
    ratedPowerKw: a.ratedPowerKw,
    laborCostPerHour: a.laborCostPerHour,
    targetCycleTimeSec: a.targetCycleTimeSec,
    maintenanceIntervalHours: a.maintenanceIntervalHours,
    lastMaintenanceAt: m.lastMaintenanceAt,
    runHoursSinceMaintenance: round1(runHours),
    maintenanceDue: a.maintenanceIntervalHours ? runHours >= a.maintenanceIntervalHours : false,
    vendorName: a.vendorName,
    purchaseDate: a.purchaseDate,
    location: a.location,
    manufacturerPhone: a.manufacturerPhone,
  };
}

function hoursSinceMaintenance(id: string) {
  const m = engine.machines[id];
  const elapsed = (Date.now() - +new Date(m.lastMaintenanceAt)) / HOUR;
  return elapsed * 0.78; // rough run-time fraction
}

const teleToApi = (p: MockTelemetry): TelemetryPoint => ({
  id: p.id,
  machineId: p.machineId,
  timestamp: p.timestamp,
  status: p.status,
  cycleTimeSec: String(p.cycleTimeSec),
  shotCount: p.shotCount,
  injectionPressureBar: String(p.injectionPressureBar),
  barrelTemperatureC: String(p.barrelTemperatureC),
});

function jobToApi(j: MockJob): ProductionJob {
  return {
    jobNumber: j.jobNumber,
    machineId: j.machineId,
    productCode: j.productCode,
    moldId: j.moldId,
    recipeId: j.recipeId,
    startTime: j.startTime,
    endTime: j.endTime,
    goodQty: j.goodQty,
    rejectQty: j.rejectQty,
    startupScrapQty: j.startupScrapQty,
    status: j.status,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// Points for a machine within a window; used to approximate time-in-status
// (each retained point stands for ~10s).
function pointsIn(machineId: string, fromMs: number, toMs: number) {
  return engine.telemetry.filter(
    (p) => p.machineId === machineId && +new Date(p.timestamp) >= fromMs && +new Date(p.timestamp) <= toMs
  );
}
const POINT_SECONDS = 10;

function statusHours(machineId: string, fromMs: number, toMs: number) {
  const acc: Record<string, number> = { RUN: 0, STOP: 0, ALARM: 0, OFFLINE: 0 };
  for (const p of pointsIn(machineId, fromMs, toMs)) acc[p.status] = (acc[p.status] ?? 0) + POINT_SECONDS / 3600;
  return acc;
}

function jobsIn(machineId: string | null, fromMs: number, toMs: number) {
  return engine.allJobs().filter((j) => {
    if (machineId && j.machineId !== machineId) return false;
    const s = +new Date(j.startTime);
    const e = j.endTime ? +new Date(j.endTime) : Date.now();
    return e >= fromMs && s <= toMs;
  });
}

function machineKpi(id: string, fromMs: number, toMs: number, hours: number): MachineKpi {
  const a = asset(id)!;
  const sh = statusHours(id, fromMs, toMs);
  const runtimeHours = sh.RUN;
  const pts = pointsIn(id, fromMs, toMs).filter((p) => p.status === "RUN");
  const avgCycle = pts.length ? pts.reduce((s, p) => s + p.cycleTimeSec, 0) / pts.length : null;
  const js = jobsIn(id, fromMs, toMs);
  const goodQty = js.reduce((s, j) => s + j.goodQty, 0);
  const rejectQty = js.reduce((s, j) => s + j.rejectQty, 0);
  const startupScrapQty = js.reduce((s, j) => s + j.startupScrapQty, 0);
  const availability = clamp01(runtimeHours / hours);
  const performance =
    avgCycle && a.targetCycleTimeSec ? clamp01(a.targetCycleTimeSec / avgCycle) : avgCycle ? 0.9 : null;
  const quality = goodQty + rejectQty > 0 ? clamp01(goodQty / (goodQty + rejectQty)) : null;
  const oee = availability != null && performance != null && quality != null ? availability * performance * quality : null;
  const estimatedEnergyKwh = a.ratedPowerKw != null ? a.ratedPowerKw * runtimeHours : null;
  const estimatedLaborCost = a.laborCostPerHour != null ? a.laborCostPerHour * runtimeHours : null;
  return {
    machineId: id,
    machineName: a.machineName,
    availability: round2(availability),
    performance: performance == null ? null : round2(performance),
    quality: quality == null ? null : round2(quality),
    oee: oee == null ? null : round2(oee),
    rejectRate: goodQty + rejectQty > 0 ? round2(rejectQty / (goodQty + rejectQty)) : null,
    runtimeHours: round1(runtimeHours),
    avgCycleTimeSec: avgCycle == null ? null : round1(avgCycle),
    targetCycleTimeSec: a.targetCycleTimeSec,
    ratedPowerKw: a.ratedPowerKw,
    estimatedEnergyKwh: estimatedEnergyKwh == null ? null : round1(estimatedEnergyKwh),
    laborCostPerHour: a.laborCostPerHour,
    estimatedLaborCost: estimatedLaborCost == null ? null : Math.round(estimatedLaborCost),
    goodQty,
    rejectQty,
    startupScrapQty,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function erpRollup(key: string, js: MockJob[]): ErpRollup {
  let revenueThb = 0;
  let materialCostThb = 0;
  let laborCostThb = 0;
  let rejectMaterialLossThb = 0;
  let hours = 0;
  for (const j of js) {
    const p = sku(j.productCode);
    const dur = ((j.endTime ? +new Date(j.endTime) : Date.now()) - +new Date(j.startTime)) / HOUR;
    hours += dur;
    const labor = asset(j.machineId)?.laborCostPerHour ?? 0;
    laborCostThb += dur * labor;
    if (p) {
      revenueThb += j.goodQty * p.unitPriceThb;
      const mat = p.materialCostPerUnitThb ?? 0;
      materialCostThb += (j.goodQty + j.rejectQty + j.startupScrapQty) * mat;
      rejectMaterialLossThb += (j.rejectQty + j.startupScrapQty) * mat;
    }
  }
  const marginThb = revenueThb - materialCostThb - laborCostThb;
  return {
    key,
    jobCount: js.length,
    goodQty: js.reduce((s, j) => s + j.goodQty, 0),
    rejectQty: js.reduce((s, j) => s + j.rejectQty, 0),
    revenueThb: Math.round(revenueThb),
    materialCostThb: Math.round(materialCostThb),
    laborCostThb: Math.round(laborCostThb),
    marginThb: Math.round(marginThb),
    marginPerHourThb: hours > 0 ? Math.round(marginThb / hours) : null,
    rejectMaterialLossThb: Math.round(rejectMaterialLossThb),
  };
}

const AUDIT_SEED: AuditLogEntry[] = [
  {
    id: "seed-3",
    actor: "chief.operator",
    action: "machine.maintenance",
    targetType: "machine",
    targetId: "IMM-03",
    detail: JSON.stringify({ note: "PM completed, counters reset" }),
    createdAt: new Date(Date.now() - 26 * HOUR).toISOString(),
  },
  {
    id: "seed-2",
    actor: "erp.officer",
    action: "sku.update",
    targetType: "product_sku",
    targetId: "PVC-110-TEE",
    detail: JSON.stringify({ unitPriceThb: 42 }),
    createdAt: new Date(Date.now() - 3 * 24 * HOUR).toISOString(),
  },
  {
    id: "seed-1",
    actor: "system",
    action: "machine.register",
    targetType: "machine",
    targetId: "IMM-01",
    detail: null,
    createdAt: new Date(Date.now() - 30 * 24 * HOUR).toISOString(),
  },
];

export const mockApi: Api = {
  getMachines: async () => MACHINE_ASSETS.map((a) => machineOf(a.assetId)),
  adminListMachines: async () => MACHINE_ASSETS.map((a) => machineOf(a.assetId)),

  getActiveAlarms: async () =>
    engine.alarms.filter((a) => !a.clearedTimestamp).map((a) => ({ ...a }) as Alarm),

  getJob: async (jobNumber: string) => {
    const j = engine.allJobs().find((x) => x.jobNumber === jobNumber);
    if (!j) throw new Error("404 job not found");
    const alarms = engine.alarms.filter((a) => a.jobNumber === jobNumber).map((a) => ({ ...a }) as Alarm);
    return { ...jobToApi(j), alarms };
  },

  searchJobs: async (params) => {
    let list = engine.allJobs().slice().reverse();
    if (params.machineId) list = list.filter((j) => j.machineId === params.machineId);
    if (params.status) list = list.filter((j) => j.status === params.status);
    if (params.productCode) list = list.filter((j) => j.productCode === params.productCode);
    if (params.q) {
      const q = params.q.toLowerCase();
      list = list.filter(
        (j) => j.jobNumber.toLowerCase().includes(q) || j.productCode.toLowerCase().includes(q)
      );
    }
    const limit = params.limit ? Number(params.limit) : 100;
    return list.slice(0, limit).map(jobToApi);
  },

  getMachineHistory: async (machineId, from, to) => {
    const { fromMs, toMs } = windowOf(from, to);
    return pointsIn(machineId, fromMs, toMs).map(teleToApi);
  },
  getMachineEvents: async (machineId, from, to) => {
    const { fromMs, toMs } = windowOf(from, to);
    return engine.statusEvents
      .filter((e) => e.machineId === machineId && within(e.changedAt, fromMs, toMs))
      .map((e) => ({ ...e }) as StatusEvent);
  },
  getMachineAlarms: async (machineId, from, to) => {
    const { fromMs, toMs } = windowOf(from, to);
    return engine.alarms
      .filter((a) => a.machineId === machineId && within(a.alarmTimestamp, fromMs, toMs))
      .map((a) => ({ ...a }) as Alarm);
  },

  getKpiSummary: async (from, to): Promise<KpiSummary> => {
    const { fromMs, toMs, hours } = windowOf(from, to);
    const machines = MACHINE_ASSETS.map((a) => machineKpi(a.assetId, fromMs, toMs, hours));
    const sum = (f: (m: MachineKpi) => number | null) =>
      machines.reduce((s, m) => s + (f(m) ?? 0), 0);
    const avg = (f: (m: MachineKpi) => number | null) => {
      const vs = machines.map(f).filter((v): v is number => v != null);
      return vs.length ? round2(vs.reduce((s, v) => s + v, 0) / vs.length) : null;
    };
    const goodQty = sum((m) => m.goodQty);
    const rejectQty = sum((m) => m.rejectQty);
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      machines,
      fleet: {
        availability: avg((m) => m.availability),
        performance: avg((m) => m.performance),
        quality: avg((m) => m.quality),
        rejectRate: goodQty + rejectQty > 0 ? round2(rejectQty / (goodQty + rejectQty)) : null,
        goodQty,
        rejectQty,
        startupScrapQty: sum((m) => m.startupScrapQty),
        estimatedEnergyKwh: round1(sum((m) => m.estimatedEnergyKwh)),
        estimatedLaborCost: Math.round(sum((m) => m.estimatedLaborCost)),
      },
    };
  },

  getErpSummary: async (from, to): Promise<ErpSummary> => {
    const { fromMs, toMs } = windowOf(from, to);
    const js = jobsIn(null, fromMs, toMs);
    const bySku = SKUS.map((s) => erpRollup(s.productCode, js.filter((j) => j.productCode === s.productCode)));
    const byMachine = MACHINE_ASSETS.map((a) =>
      erpRollup(a.assetId, js.filter((j) => j.machineId === a.assetId))
    );
    const all = erpRollup("all", js);
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      unpricedJobCount: js.filter((j) => !sku(j.productCode)).length,
      totals: {
        goodQty: all.goodQty,
        rejectQty: all.rejectQty,
        revenueThb: all.revenueThb,
        materialCostThb: all.materialCostThb,
        laborCostThb: all.laborCostThb,
        marginThb: all.marginThb,
        marginPerHourThb: all.marginPerHourThb,
      },
      bySku,
      byMachine,
    };
  },

  getMaintenanceOverview: async (from, to): Promise<MaintenanceOverview> => {
    const { fromMs, toMs } = windowOf(from, to);
    const machines = MACHINE_ASSETS.map((a) => {
      const sh = statusHours(a.assetId, fromMs, toMs);
      const runHours = hoursSinceMaintenance(a.assetId);
      const alarms = engine.alarms.filter(
        (al) => al.machineId === a.assetId && within(al.alarmTimestamp, fromMs, toMs)
      );
      const reasons = groupAlarms(alarms);
      return {
        machineId: a.assetId,
        machineName: a.machineName,
        machineModel: a.machineModel,
        dataSource: "SIMULATOR" as const,
        runHoursSinceMaintenance: round1(runHours),
        maintenanceIntervalHours: a.maintenanceIntervalHours,
        pctOfInterval: a.maintenanceIntervalHours ? round2(runHours / a.maintenanceIntervalHours) : null,
        maintenanceDue: a.maintenanceIntervalHours ? runHours >= a.maintenanceIntervalHours : false,
        statusHours: mapVals(sh, round1),
        intentionalDowntimeHours: round1(sh.STOP),
        errorDowntimeHours: round1(sh.ALARM),
        offlineHours: round1(sh.OFFLINE),
        otherDowntimeHours: 0,
        alarmCount: alarms.length,
        topReasons: reasons,
      };
    });
    const byModel = Object.values(
      machines.reduce<Record<string, MaintenanceOverview["byModel"][number]>>((acc, m) => {
        const key = m.machineModel ?? "Unknown";
        acc[key] ??= {
          machineModel: key,
          machineCount: 0,
          totalErrorDowntimeHours: 0,
          totalIntentionalDowntimeHours: 0,
          totalOfflineHours: 0,
          totalOtherDowntimeHours: 0,
          totalAlarmCount: 0,
          machinesOverdue: 0,
          topReasons: [],
        };
        const g = acc[key];
        g.machineCount += 1;
        g.totalErrorDowntimeHours = round1(g.totalErrorDowntimeHours + m.errorDowntimeHours);
        g.totalIntentionalDowntimeHours = round1(g.totalIntentionalDowntimeHours + m.intentionalDowntimeHours);
        g.totalOfflineHours = round1(g.totalOfflineHours + (m.offlineHours ?? 0));
        g.totalOtherDowntimeHours = round1(g.totalOtherDowntimeHours + m.otherDowntimeHours);
        g.totalAlarmCount += m.alarmCount;
        if (m.maintenanceDue) g.machinesOverdue += 1;
        g.topReasons = mergeReasons(g.topReasons, m.topReasons).slice(0, 5);
        return acc;
      }, {})
    );
    return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), machines, byModel };
  },

  getGateways: async () => GATEWAYS.map((g) => ({ ...g }) as Gateway),
  getGatewayMachines: async () => [],

  getMachineAssets: async (): Promise<ErpMachineAsset[]> =>
    MACHINE_ASSETS.map((a) => ({
      ...a,
      createdAt: new Date(Date.now() - 400 * 24 * HOUR).toISOString(),
      updatedAt: new Date(Date.now() - 20 * 24 * HOUR).toISOString(),
      registered: true,
    })),

  getSkus: async (): Promise<ProductSku[]> => SKUS.map((s) => ({ ...s })),

  getErpJobOrders: async (): Promise<ErpJobOrder[]> =>
    engine.allJobs().map((j) => ({
      jobNumber: j.jobNumber,
      productCode: j.productCode,
      quantityOrdered: j.orderedQty,
      createdAt: j.startTime,
      updatedAt: j.endTime ?? j.startTime,
    })),

  getAuditLog: async (params) => {
    let list = AUDIT_SEED.slice();
    if (params.targetId) list = list.filter((e) => e.targetId === params.targetId);
    if (params.action) list = list.filter((e) => e.action === params.action);
    return list.slice(0, params.limit ? Number(params.limit) : 100);
  },

  getSystemStats: async (): Promise<SystemStats> => {
    const t = engine.telemetry;
    const rowCounts: Record<string, number> = {
      machine_telemetry: t.length,
      machine_status_events: engine.statusEvents.length,
      production_jobs: engine.allJobs().length,
      alarms: engine.alarms.length,
      machines: MACHINE_ASSETS.length,
      erp_machine_assets: MACHINE_ASSETS.length,
      product_skus: SKUS.length,
      erp_job_orders: engine.allJobs().length,
      gateways: GATEWAYS.length,
      audit_log: AUDIT_SEED.length,
    };
    const totalRows = Object.values(rowCounts).reduce((s, n) => s + n, 0);
    const bytes = totalRows * 96;
    return {
      machines: { total: MACHINE_ASSETS.length, active: MACHINE_ASSETS.length, manual: 0 },
      rowCounts,
      telemetry: {
        oldest: t[0]?.timestamp ?? null,
        newest: t[t.length - 1]?.timestamp ?? null,
        rowsLast60s: 90,
        rowsLast5m: 450,
        estimatedRowsPerSecond: 1.5,
      },
      database: {
        totalSizePretty: `${(bytes / 1e6).toFixed(1)} MB`,
        totalSizeBytes: bytes,
        tables: Object.entries(rowCounts)
          .map(([name, n]) => ({
            name,
            sizeBytes: n * 96,
            sizePretty: `${((n * 96) / 1e6).toFixed(2)} MB`,
          }))
          .sort((a, b) => b.sizeBytes - a.sizeBytes),
      },
    };
  },

  getSimulatorParams: async (machineId: string) => ({
    machineId,
    tuning: { ...SIMULATOR_DEFAULT_TUNING } as SimulatorTuning,
  }),

  // ---- writes: never reach a backend, just prompt ----------------------
  adminCreateMachine: locked,
  adminManualRegisterMachine: locked,
  createGateway: locked,
  updateGateway: locked,
  deleteGateway: lockedResponse,
  adminPatchMachine: locked,
  adminLogMaintenance: locked,
  setMachineAsset: locked,
  deleteMachineAsset: lockedResponse,
  importJobs: locked,
  setSkuPrice: locked,
  deleteSku: lockedResponse,
  setErpJobOrder: locked,
  deleteErpJobOrder: lockedResponse,
  patchSimulatorParams: locked,
};

function within(iso: string, fromMs: number, toMs: number) {
  const t = +new Date(iso);
  return t >= fromMs && t <= toMs;
}
function mapVals(o: Record<string, number>, f: (n: number) => number) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}
type Reason = { alarmCode: string; alarmMessage: string; count: number; hours: number };
function mergeReasons(...lists: Reason[][]): Reason[] {
  const by: Record<string, Reason> = {};
  for (const r of lists.flat()) {
    by[r.alarmCode] ??= { ...r, count: 0, hours: 0 };
    by[r.alarmCode].count += r.count;
    by[r.alarmCode].hours = round1(by[r.alarmCode].hours + r.hours);
  }
  return Object.values(by).sort((a, b) => b.count - a.count);
}
function groupAlarms(alarms: { alarmCode: string; alarmMessage: string }[]) {
  const by: Record<string, { alarmCode: string; alarmMessage: string; count: number; hours: number }> = {};
  for (const a of alarms) {
    by[a.alarmCode] ??= { alarmCode: a.alarmCode, alarmMessage: a.alarmMessage, count: 0, hours: 0 };
    by[a.alarmCode].count += 1;
    by[a.alarmCode].hours = round1(by[a.alarmCode].hours + 0.3);
  }
  return Object.values(by).sort((a, b) => b.count - a.count);
}
