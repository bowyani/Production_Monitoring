import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { logAudit } from "../audit";
import { ensureSimulatorContainer, stopSimulatorContainer } from "../docker/simulatorManager";

export const adminRouter = Router();

const createMachineSchema = z.object({
  machineId: z.string().min(1),
  machineName: z.string().min(1),
  machineModel: z.string().optional(),
  dataSource: z.enum(["MQTT", "MANUAL"]).default("MQTT"),
  ratedPowerKw: z.number().optional(),
  laborCostPerHour: z.number().optional(),
  targetCycleTimeSec: z.number().optional(),
  maintenanceIntervalHours: z.number().optional(),
  createdBy: z.string().optional(),
});

const patchMachineSchema = z.object({
  machineName: z.string().min(1).optional(),
  machineModel: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  ratedPowerKw: z.number().nullable().optional(),
  laborCostPerHour: z.number().nullable().optional(),
  targetCycleTimeSec: z.number().nullable().optional(),
  maintenanceIntervalHours: z.number().nullable().optional(),
});

// New machines are inserted here, not hardcoded — MQTT wildcard subscription
// (factory/+/...) means telemetry starts flowing the moment this returns,
// no service restart required. See README.md ("Design Rationale" section).
// For MQTT-sourced machines, this also launches a Docker-managed simulator
// container so it starts publishing immediately — no manual `docker compose
// run` needed. Best-effort: if Docker management isn't available, the
// machine still registers, it just shows OFFLINE until something publishes.
adminRouter.post("/admin/machines", async (req, res) => {
  const parsed = createMachineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const machine = await prisma.machine.create({ data: parsed.data });
    await logAudit("admin-ui", "MACHINE_CREATED", "machine", machine.machineId, parsed.data);

    let simulator: { ok: boolean; reason?: string; reused?: boolean } | undefined;
    if (parsed.data.dataSource === "MQTT") {
      simulator = await ensureSimulatorContainer(machine.machineId, machine.machineName);
    }
    res.status(201).json({ ...machine, simulator });
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

  // Running hours since last maintenance = sum of RUN-duration from status
  // events after lastMaintenanceAt. Same accrual logic as the KPI
  // availability calc, just over an unbounded/per-machine window instead of
  // a report window.
  const enriched = await Promise.all(
    machines.map(async (m) => {
      const runHoursSinceMaintenance = await computeRunHoursSince(m.machineId, m.lastMaintenanceAt);
      const intervalHours = m.maintenanceIntervalHours ? Number(m.maintenanceIntervalHours) : null;
      return {
        ...m,
        runHoursSinceMaintenance,
        maintenanceDue: intervalHours != null ? runHoursSinceMaintenance >= intervalHours : false,
      };
    })
  );
  res.json(enriched);
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
  await logAudit(
    "admin-ui",
    parsed.data.isActive === false
      ? "MACHINE_DEACTIVATED"
      : parsed.data.isActive === true
        ? "MACHINE_ACTIVATED"
        : "MACHINE_UPDATED",
    "machine",
    machine.machineId,
    parsed.data
  );

  // Container control is a convenience layer on top of the ingestion-level
  // block above, not a replacement for it — deactivating always stops
  // ingestion even if Docker control fails or this isn't a managed machine.
  let simulator: { ok: boolean; reason?: string } | undefined;
  if (machine.dataSource === "MQTT") {
    if (parsed.data.isActive === false) {
      simulator = await stopSimulatorContainer(machine.machineId);
    } else if (parsed.data.isActive === true) {
      simulator = await ensureSimulatorContainer(machine.machineId, machine.machineName);
    }
  }

  res.json({ ...machine, simulator });
});

adminRouter.post("/admin/machines/:id/maintenance", async (req, res) => {
  const machine = await prisma.machine.update({
    where: { machineId: req.params.id },
    data: { lastMaintenanceAt: new Date() },
  });
  await logAudit("admin-ui", "MAINTENANCE_LOGGED", "machine", machine.machineId, {
    at: machine.lastMaintenanceAt,
  });
  res.json(machine);
});

async function computeRunHoursSince(machineId: string, since: Date) {
  const priorEvent = await prisma.machineStatusEvent.findFirst({
    where: { machineId, changedAt: { lte: since } },
    orderBy: { changedAt: "desc" },
  });
  const eventsAfter = await prisma.machineStatusEvent.findMany({
    where: { machineId, changedAt: { gt: since } },
    orderBy: { changedAt: "asc" },
  });
  const machine = await prisma.machine.findUnique({ where: { machineId } });

  let cursor = since;
  let cursorStatus = priorEvent?.toStatus ?? eventsAfter[0]?.fromStatus ?? machine?.status ?? "OFFLINE";
  let runMs = 0;
  const now = new Date();
  for (const event of eventsAfter) {
    if (cursorStatus === "RUN") runMs += event.changedAt.getTime() - cursor.getTime();
    cursor = event.changedAt;
    cursorStatus = event.toStatus;
  }
  if (cursorStatus === "RUN") runMs += now.getTime() - cursor.getTime();
  return runMs / 3_600_000;
}
