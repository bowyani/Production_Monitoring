import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

export const adminRouter = Router();

const createMachineSchema = z.object({
  machineId: z.string().min(1),
  machineName: z.string().min(1),
  ratedPowerKw: z.number().optional(),
  laborCostPerHour: z.number().optional(),
  targetCycleTimeSec: z.number().optional(),
  createdBy: z.string().optional(),
});

const patchMachineSchema = z.object({
  machineName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  ratedPowerKw: z.number().nullable().optional(),
  laborCostPerHour: z.number().nullable().optional(),
  targetCycleTimeSec: z.number().nullable().optional(),
});

// New machines are inserted here, not hardcoded — MQTT wildcard subscription
// (factory/+/...) means telemetry starts flowing the moment this returns,
// no service restart required. See DESIGN_RATIONALE.md §1.
adminRouter.post("/admin/machines", async (req, res) => {
  const parsed = createMachineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const machine = await prisma.machine.create({ data: parsed.data });
    res.status(201).json(machine);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "machineId already registered" });
      return;
    }
    throw err;
  }
});

adminRouter.get("/admin/machines", async (_req, res) => {
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: "desc" } });
  res.json(machines);
});

adminRouter.patch("/admin/machines/:id", async (req, res) => {
  const parsed = patchMachineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data: Prisma.MachineUpdateInput = { ...parsed.data };
  // Deactivating stops MQTT ingestion for this machine (see subscriber.ts), so
  // its status would otherwise stay frozen at whatever it last was (e.g. RUN).
  // Reactivating clears it back to OFFLINE until new telemetry actually arrives,
  // rather than showing the stale pre-deactivation status.
  if (parsed.data.isActive === false) data.status = "INACTIVE";
  if (parsed.data.isActive === true) data.status = "OFFLINE";

  const machine = await prisma.machine.update({
    where: { machineId: req.params.id },
    data,
  });
  res.json(machine);
});
