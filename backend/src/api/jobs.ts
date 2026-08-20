import { Router } from "express";
import { prisma } from "../db/client";

export const jobsRouter = Router();

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
