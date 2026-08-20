import { Router } from "express";
import { prisma } from "../db/client";

export const alarmsRouter = Router();

alarmsRouter.get("/alarms/active", async (_req, res) => {
  const alarms = await prisma.alarm.findMany({
    where: { clearedTimestamp: null },
    orderBy: { alarmTimestamp: "desc" },
  });
  res.json(alarms);
});
