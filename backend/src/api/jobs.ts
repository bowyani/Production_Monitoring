import { Router } from "express";
import { prisma } from "../db/client";

export const jobsRouter = Router();

jobsRouter.get("/jobs", async (req, res) => {
  const { machineId, q, limit } = req.query;
  const jobs = await prisma.productionJob.findMany({
    where: {
      machineId: machineId ? String(machineId) : undefined,
      jobNumber: q ? { contains: String(q), mode: "insensitive" } : undefined,
    },
    orderBy: { startTime: "desc" },
    take: limit ? Number(limit) : 20,
  });
  res.json(jobs);
});

jobsRouter.get("/jobs/:jobNumber", async (req, res) => {
  const job = await prisma.productionJob.findUnique({
    where: { jobNumber: req.params.jobNumber },
    include: { alarms: true },
  });
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  res.json(job);
});
