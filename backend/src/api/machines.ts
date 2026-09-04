import { Router } from "express";
import { prisma } from "../db/client";

export const machinesRouter = Router();

machinesRouter.get("/machines", async (_req, res) => {
  const machines = await prisma.machine.findMany({
    where: { isActive: true },
    include: { asset: true, connectionConfig: true },
  });
  // Flattened so every other view (Operator/History/KPI/Import) keeps reading
  // machine.machineName etc. unchanged even though storage moved to
  // ErpMachineAsset — see admin.ts's flattenAsset for the same shape.
  // connectionType is surfaced alongside data_source for the dashboard badge.
  res.json(
    machines.map(({ asset, connectionConfig, ...m }) => ({
      ...m,
      ...asset,
      machineId: m.machineId,
      connectionType: connectionConfig?.connectionType ?? null,
    }))
  );
});

machinesRouter.get("/machines/:id/history", async (req, res) => {
  const { from, to } = req.query;
  const telemetry = await prisma.machineTelemetry.findMany({
    where: {
      machineId: req.params.id,
      timestamp: {
        gte: from ? new Date(String(from)) : undefined,
        lte: to ? new Date(String(to)) : undefined,
      },
    },
    orderBy: { timestamp: "asc" },
  });
  res.json(telemetry);
});

machinesRouter.get("/machines/:id/events", async (req, res) => {
  const { from, to } = req.query;
  const events = await prisma.machineStatusEvent.findMany({
    where: {
      machineId: req.params.id,
      changedAt: {
        gte: from ? new Date(String(from)) : undefined,
        lte: to ? new Date(String(to)) : undefined,
      },
    },
    orderBy: { changedAt: "desc" },
  });
  res.json(events);
});

machinesRouter.get("/machines/:id/alarms", async (req, res) => {
  const { from, to } = req.query;
  const alarms = await prisma.alarm.findMany({
    where: {
      machineId: req.params.id,
      alarmTimestamp: {
        gte: from ? new Date(String(from)) : undefined,
        lte: to ? new Date(String(to)) : undefined,
      },
    },
    orderBy: { alarmTimestamp: "desc" },
  });
  res.json(alarms);
});
