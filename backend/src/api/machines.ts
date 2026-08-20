import { Router } from "express";
import { prisma } from "../db/client";

export const machinesRouter = Router();

machinesRouter.get("/machines", async (_req, res) => {
  const machines = await prisma.machine.findMany({ where: { isActive: true } });
  res.json(machines);
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
