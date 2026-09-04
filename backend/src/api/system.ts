import { Router } from "express";
import { prisma } from "../db/client";

export const systemRouter = Router();

// Audit trail read endpoint — answers Direction.md §4.2 "มี Log สำหรับตรวจสอบ
// การทำงานเบื้องต้น" (basic operational logging you can inspect).
systemRouter.get("/admin/audit-log", async (req, res) => {
  const { targetId, action, limit } = req.query;
  const entries = await prisma.auditLog.findMany({
    where: {
      targetId: targetId ? String(targetId) : undefined,
      action: action ? String(action) : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: limit ? Number(limit) : 100,
  });
  res.json(entries);
});

type TableSizeRow = { relname: string; bytes: bigint; pretty: string };
type DbSizeRow = { bytes: bigint; pretty: string };

// Answers the "how is performance / what should IT worry about" question —
// this is the operational-health page an IT/ops person (not the factory
// operator) would check. Everything here is a live number computed against
// the actual database, not a canned estimate.
systemRouter.get("/admin/system-stats", async (_req, res) => {
  const [
    machineCount,
    activeMachineCount,
    manualMachineCount,
    telemetryCount,
    statusEventCount,
    jobCount,
    alarmCount,
    auditLogCount,
    oldestTelemetry,
    newestTelemetry,
    telemetryLast60s,
    telemetryLast5m,
  ] = await Promise.all([
    prisma.machine.count(),
    prisma.machine.count({ where: { isActive: true } }),
    prisma.machine.count({ where: { dataSource: "MANUAL_CSV" } }),
    prisma.machineTelemetry.count(),
    prisma.machineStatusEvent.count(),
    prisma.productionJob.count(),
    prisma.alarm.count(),
    prisma.auditLog.count(),
    prisma.machineTelemetry.findFirst({ orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
    prisma.machineTelemetry.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
    prisma.machineTelemetry.count({ where: { timestamp: { gte: new Date(Date.now() - 60_000) } } }),
    prisma.machineTelemetry.count({ where: { timestamp: { gte: new Date(Date.now() - 300_000) } } }),
  ]);

  const dbSizeRows = await prisma.$queryRaw<DbSizeRow[]>`
    SELECT pg_database_size(current_database()) AS bytes,
           pg_size_pretty(pg_database_size(current_database())) AS pretty
  `;
  const tableSizeRows = await prisma.$queryRaw<TableSizeRow[]>`
    SELECT relname,
           pg_total_relation_size(relid) AS bytes,
           pg_size_pretty(pg_total_relation_size(relid)) AS pretty
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;

  res.json({
    machines: { total: machineCount, active: activeMachineCount, manual: manualMachineCount },
    rowCounts: {
      machine_telemetry: telemetryCount,
      machine_status_events: statusEventCount,
      production_jobs: jobCount,
      alarms: alarmCount,
      audit_log: auditLogCount,
    },
    telemetry: {
      oldest: oldestTelemetry?.timestamp ?? null,
      newest: newestTelemetry?.timestamp ?? null,
      rowsLast60s: telemetryLast60s,
      rowsLast5m: telemetryLast5m,
      estimatedRowsPerSecond: Number((telemetryLast5m / 300).toFixed(2)),
    },
    database: {
      totalSizePretty: dbSizeRows[0]?.pretty ?? null,
      totalSizeBytes: dbSizeRows[0] ? Number(dbSizeRows[0].bytes) : null,
      tables: tableSizeRows.map((t) => ({
        name: t.relname,
        sizePretty: t.pretty,
        sizeBytes: Number(t.bytes),
      })),
    },
  });
});
