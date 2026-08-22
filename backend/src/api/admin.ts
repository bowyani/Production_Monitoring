import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { logAudit } from "../audit";
import { ensureSimulatorContainer, stopSimulatorContainer } from "../docker/simulatorManager";

export const adminRouter = Router();

// Admin is now "IT system management" — connect/disconnect a machine and
// watch its live status. It no longer takes asset specs as free text: a
// machine must already exist as an ErpMachineAsset (see erp.ts), and Admin
// just picks which asset to bring online. That's what prevents the same
// physical machine from being registered twice with mismatched specs.
const createMachineSchema = z.object({
  assetId: z.string().min(1),
  dataSource: z.enum(["MQTT", "MANUAL"]).default("MQTT"),
  createdBy: z.string().optional(),
});

const patchMachineSchema = z.object({
  isActive: z.boolean().optional(),
});

function flattenAsset<T extends { asset: { machineName: string; machineModel: string | null } }>(machine: T) {
  const { asset, ...rest } = machine;
  return { ...rest, ...asset, machineId: (machine as unknown as { machineId: string }).machineId };
}

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
  const asset = await prisma.erpMachineAsset.findUnique({ where: { assetId: parsed.data.assetId } });
  if (!asset) {
    res.status(404).json({ error: `no ERP asset ${parsed.data.assetId} — add it in ERP first` });
    return;
  }
  try {
    const machine = await prisma.machine.create({
      data: {
        machineId: parsed.data.assetId,
        dataSource: parsed.data.dataSource,
        createdBy: parsed.data.createdBy,
      },
      include: { asset: true },
    });
    await logAudit("admin-ui", "MACHINE_CREATED", "machine", machine.machineId, parsed.data);

    let simulator: { ok: boolean; reason?: string; reused?: boolean } | undefined;
    if (parsed.data.dataSource === "MQTT") {
      simulator = await ensureSimulatorContainer(machine.machineId, asset.machineName);
      if (simulator.ok) {
        // actor "docker" — Docker Engine itself did this, distinct from the
        // "admin-ui" MACHINE_CREATED entry above (the human's click).
        await logAudit(
          "docker",
          simulator.reused ? "SIMULATOR_CONTAINER_REUSED" : "SIMULATOR_CONTAINER_STARTED",
          "machine",
          machine.machineId,
          null
        );
      }
    }
    res.status(201).json({ ...flattenAsset(machine), simulator });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "this ERP asset is already registered as a machine" });
      return;
    }
    throw err;
  }
});

adminRouter.get("/admin/machines", async (_req, res) => {
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: "desc" }, include: { asset: true } });

  // Running hours since last maintenance = sum of RUN-duration from status
  // events after lastMaintenanceAt. Same accrual logic as the KPI
  // availability calc, just over an unbounded/per-machine window instead of
  // a report window.
  const enriched = await Promise.all(
    machines.map(async (m) => {
      const runHoursSinceMaintenance = await computeRunHoursSince(m.machineId, m.lastMaintenanceAt);
      const intervalHours = m.asset.maintenanceIntervalHours ? Number(m.asset.maintenanceIntervalHours) : null;
      return {
        ...flattenAsset(m),
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
  const exists = await prisma.machine.findUnique({ where: { machineId: req.params.id } });
  if (!exists) {
    res.status(404).json({ error: `machine ${req.params.id} not found` });
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
    include: { asset: true },
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
      if (simulator.ok) await logAudit("docker", "SIMULATOR_CONTAINER_STOPPED", "machine", machine.machineId, null);
    } else if (parsed.data.isActive === true) {
      simulator = await ensureSimulatorContainer(machine.machineId, machine.asset.machineName);
      if (simulator.ok) await logAudit("docker", "SIMULATOR_CONTAINER_STARTED", "machine", machine.machineId, null);
    }
  }

  res.json({ ...flattenAsset(machine), simulator });
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

export async function computeRunHoursSince(machineId: string, since: Date) {
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
