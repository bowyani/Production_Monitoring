import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

export const jobsRouter = Router();

const SORTABLE_FIELDS = new Set(["startTime", "jobNumber", "goodQty", "rejectQty", "status"]);

jobsRouter.get("/jobs", async (req, res) => {
  const { machineId, q, productCode, status, from, to, sort, dir, limit } = req.query;

  const where: Prisma.ProductionJobWhereInput = {
    machineId: machineId ? String(machineId) : undefined,
    jobNumber: q ? { contains: String(q), mode: "insensitive" } : undefined,
    productCode: productCode ? { contains: String(productCode), mode: "insensitive" } : undefined,
    status: status ? String(status) : undefined,
    startTime: {
      gte: from ? new Date(String(from)) : undefined,
      lte: to ? new Date(String(to)) : undefined,
    },
  };

  const sortField = typeof sort === "string" && SORTABLE_FIELDS.has(sort) ? sort : "startTime";
  const sortDir = dir === "asc" ? "asc" : "desc";

  const jobs = await prisma.productionJob.findMany({
    where,
    orderBy: { [sortField]: sortDir },
    take: limit ? Number(limit) : 50,
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
