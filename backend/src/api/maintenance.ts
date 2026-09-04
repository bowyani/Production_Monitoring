import { Router } from "express";
import { prisma } from "../db/client";
import type { Machine, ErpMachineAsset } from "@prisma/client";
import { computeRunHoursSince } from "./admin";

// Chief-operator view: per-machine runtime/downtime breakdown + preventive
// maintenance status, and a fleet rollup by machine model to answer "which
// model/brand tends to have problems". MANUAL machines have no
// machine_status_events (no telemetry ever arrives for them), so their
// downtime/runtime fields come back null rather than a misleading zero —
// same blind-spot reasoning as kpi.ts.
export const maintenanceRouter = Router();

const DOWNTIME_STATUSES = ["STOP", "ALARM", "OFFLINE"] as const;

maintenanceRouter.get("/maintenance/overview", async (req, res) => {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  const machines = await prisma.machine.findMany({
    where: { isActive: true },
    orderBy: { machineId: "asc" },
    include: { asset: true },
  });
  const results = await Promise.all(machines.map((m) => computeMachineMaintenance(m, from, to)));

  const byModel = rollUpByModel(results);

  res.json({ from, to, machines: results, byModel });
});

async function computeMachineMaintenance(machine: Machine & { asset: ErpMachineAsset }, from: Date, to: Date) {
  const runHoursSinceMaintenance = await computeRunHoursSince(machine.machineId, machine.lastMaintenanceAt);
  const maintenanceIntervalHours = machine.asset.maintenanceIntervalHours
    ? Number(machine.asset.maintenanceIntervalHours)
    : null;
  const pctOfInterval =
    maintenanceIntervalHours && maintenanceIntervalHours > 0
      ? Math.min(2, runHoursSinceMaintenance / maintenanceIntervalHours)
      : null;

  if (machine.dataSource === "MANUAL_CSV") {
    return {
      machineId: machine.machineId,
      machineName: machine.asset.machineName,
      machineModel: machine.asset.machineModel,
      dataSource: machine.dataSource,
      runHoursSinceMaintenance,
      maintenanceIntervalHours,
      pctOfInterval,
      maintenanceDue: maintenanceIntervalHours != null ? runHoursSinceMaintenance >= maintenanceIntervalHours : false,
      statusHours: null,
      intentionalDowntimeHours: null,
      errorDowntimeHours: null,
      offlineHours: null,
      otherDowntimeHours: null,
      alarmCount: 0,
      topReasons: [] as { alarmCode: string; alarmMessage: string; count: number; hours: number }[],
    };
  }

  const priorEvent = await prisma.machineStatusEvent.findFirst({
    where: { machineId: machine.machineId, changedAt: { lte: from } },
    orderBy: { changedAt: "desc" },
  });
  const eventsInWindow = await prisma.machineStatusEvent.findMany({
    where: { machineId: machine.machineId, changedAt: { gt: from, lte: to } },
    orderBy: { changedAt: "asc" },
  });

  const statusMs: Record<string, number> = {};
  const accrue = (status: string, ms: number) => {
    statusMs[status] = (statusMs[status] ?? 0) + Math.max(0, ms);
  };

  let cursor = from;
  let cursorStatus = priorEvent?.toStatus ?? eventsInWindow[0]?.fromStatus ?? machine.status;
  for (const event of eventsInWindow) {
    accrue(cursorStatus, event.changedAt.getTime() - cursor.getTime());
    cursor = event.changedAt;
    cursorStatus = event.toStatus;
  }
  accrue(cursorStatus, to.getTime() - cursor.getTime());

  const statusHours: Record<string, number> = {};
  for (const [status, ms] of Object.entries(statusMs)) statusHours[status] = ms / 3_600_000;

  const alarmsInWindow = await prisma.alarm.findMany({
    where: {
      machineId: machine.machineId,
      alarmTimestamp: { lte: to },
      OR: [{ clearedTimestamp: null }, { clearedTimestamp: { gte: from } }],
    },
  });

  const reasonMap = new Map<string, { alarmCode: string; alarmMessage: string; count: number; hours: number }>();
  for (const alarm of alarmsInWindow) {
    const start = alarm.alarmTimestamp > from ? alarm.alarmTimestamp : from;
    const end = alarm.clearedTimestamp && alarm.clearedTimestamp < to ? alarm.clearedTimestamp : to;
    const hours = Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
    const key = `${alarm.alarmCode}::${alarm.alarmMessage}`;
    const entry = reasonMap.get(key) ?? { alarmCode: alarm.alarmCode, alarmMessage: alarm.alarmMessage, count: 0, hours: 0 };
    entry.count += 1;
    entry.hours += hours;
    reasonMap.set(key, entry);
  }
  const topReasons = [...reasonMap.values()].sort((a, b) => b.hours - a.hours).slice(0, 5);

  // Any status besides RUN/STOP/ALARM/OFFLINE (e.g. IDLE from a CSV import
  // that used a status word this system doesn't otherwise produce) still
  // counts as time the machine wasn't running — bucketed as "other" rather
  // than silently dropped from the downtime totals.
  const KNOWN_STATUSES = new Set(["RUN", "STOP", "ALARM", "OFFLINE"]);
  const otherHours = Object.entries(statusHours)
    .filter(([status]) => !KNOWN_STATUSES.has(status))
    .reduce((a, [, h]) => a + h, 0);

  return {
    machineId: machine.machineId,
    machineName: machine.asset.machineName,
    machineModel: machine.asset.machineModel,
    dataSource: machine.dataSource,
    runHoursSinceMaintenance,
    maintenanceIntervalHours,
    pctOfInterval,
    maintenanceDue: maintenanceIntervalHours != null ? runHoursSinceMaintenance >= maintenanceIntervalHours : false,
    statusHours,
    intentionalDowntimeHours: statusHours.STOP ?? 0,
    errorDowntimeHours: statusHours.ALARM ?? 0,
    offlineHours: statusHours.OFFLINE ?? 0,
    otherDowntimeHours: otherHours,
    alarmCount: alarmsInWindow.length,
    topReasons,
  };
}

function rollUpByModel(results: Awaited<ReturnType<typeof computeMachineMaintenance>>[]) {
  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const key = r.machineModel ?? "Unspecified model";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .map(([machineModel, group]) => {
      const reasonTotals = new Map<string, { alarmCode: string; alarmMessage: string; count: number; hours: number }>();
      for (const r of group) {
        for (const reason of r.topReasons) {
          const key = `${reason.alarmCode}::${reason.alarmMessage}`;
          const entry = reasonTotals.get(key) ?? { alarmCode: reason.alarmCode, alarmMessage: reason.alarmMessage, count: 0, hours: 0 };
          entry.count += reason.count;
          entry.hours += reason.hours;
          reasonTotals.set(key, entry);
        }
      }
      return {
        machineModel,
        machineCount: group.length,
        totalErrorDowntimeHours: sum(group.map((r) => r.errorDowntimeHours ?? 0)),
        totalIntentionalDowntimeHours: sum(group.map((r) => r.intentionalDowntimeHours ?? 0)),
        totalOfflineHours: sum(group.map((r) => r.offlineHours ?? 0)),
        totalOtherDowntimeHours: sum(group.map((r) => r.otherDowntimeHours ?? 0)),
        totalAlarmCount: sum(group.map((r) => r.alarmCount)),
        machinesOverdue: group.filter((r) => r.maintenanceDue).length,
        topReasons: [...reasonTotals.values()].sort((a, b) => b.hours - a.hours).slice(0, 5),
      };
    })
    .sort((a, b) => b.totalErrorDowntimeHours - a.totalErrorDowntimeHours);
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
