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
//
// Two registration paths, split by what's actually on the other end of the
// wire (see README "ถ้าเป็นเครื่องจักรจริง จะต่างจาก Simulator ตรงไหนบ้าง"):
//   POST /admin/machines               — a simulator (or a bare self-register
//                                        from the simulator container itself);
//                                        spins up a Docker container.
//   POST /admin/machines/manual-register — a physical machine reached over
//                                        Modbus via a Gateway; no container,
//                                        just persists the connection config.
// Both write exactly one MachineConnectionConfig row (1:1 with Machine).

const createMachineSchema = z.object({
  assetId: z.string().min(1),
  // "SIMULATOR" spins up a container; "MANUAL_CSV" is a legacy machine with
  // no live feed (CSV import only). Modbus-backed machines go through
  // /admin/machines/manual-register instead. Field name kept as `dataSource`
  // for wire-compat with the simulator's self-register call.
  dataSource: z.enum(["SIMULATOR", "MANUAL_CSV"]).default("SIMULATOR"),
  createdBy: z.string().optional(),
});

// data_source on Machine is the coarse column every view reads; connection_type
// on the config is the precise one. MODBUS_TCP/RTU both roll up to MODBUS_GATEWAY.
const CONNECTION_TO_DATA_SOURCE = {
  SIMULATOR: "SIMULATOR",
  MANUAL_CSV: "MANUAL_CSV",
  MODBUS_TCP: "MODBUS_GATEWAY",
  MODBUS_RTU: "MODBUS_GATEWAY",
} as const;
type ConnectionType = keyof typeof CONNECTION_TO_DATA_SOURCE;

const manualRegisterSchema = z
  .object({
    assetId: z.string().min(1),
    connectionType: z.enum(["MODBUS_TCP", "MODBUS_RTU"]),
    gatewayId: z.string().min(1),
    // Modbus slave/unit id — 1..247 addressable, 0 is the broadcast address.
    modbusSlaveId: z.number().int().min(0).max(247),
    modbusIp: z.string().min(1).optional(),
    modbusPort: z.number().int().min(1).max(65535).optional(),
    registerMap: z.record(z.string().min(1), z.number().int()).optional(),
    createdBy: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // A TCP gateway reaches the PLC by IP:port; an RTU one by serial line, so
    // ip/port are meaningless there. Enforce the pairing that actually makes
    // the config usable.
    if (val.connectionType === "MODBUS_TCP") {
      if (!val.modbusIp)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modbusIp"], message: "modbusIp is required for MODBUS_TCP" });
      if (val.modbusPort == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["modbusPort"], message: "modbusPort is required for MODBUS_TCP" });
    }
  });

// No two machines on one gateway may claim the same Modbus slave id. Checked
// here (not only via the DB unique index) so the error names the machine
// already holding it instead of surfacing a raw constraint violation.
async function findSlaveIdConflict(gatewayId: string, modbusSlaveId: number, exceptMachineId?: string) {
  const clash = await prisma.machineConnectionConfig.findFirst({
    where: {
      gatewayId,
      modbusSlaveId,
      ...(exceptMachineId ? { machineId: { not: exceptMachineId } } : {}),
    },
  });
  return clash?.machineId ?? null;
}

const patchMachineSchema = z.object({
  isActive: z.boolean().optional(),
});

function flattenAsset<
  T extends {
    asset: { machineName: string; machineModel: string | null };
    connectionConfig?: { connectionType: string } | null;
  },
>(machine: T) {
  const { asset, connectionConfig, ...rest } = machine;
  return {
    ...rest,
    ...asset,
    machineId: (machine as unknown as { machineId: string }).machineId,
    // Precise connection kind for the dashboard's badge; null only for a row
    // that predates the config table and somehow missed the backfill.
    connectionType: connectionConfig?.connectionType ?? null,
  };
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
        // 1:1 config row written alongside the machine — a SIMULATOR self
        // register still ends up with a complete connection record, same as
        // a Modbus machine registered through /manual-register.
        connectionConfig: { create: { connectionType: parsed.data.dataSource } },
      },
      include: { asset: true, connectionConfig: true },
    });
    await logAudit("admin-ui", "MACHINE_CREATED", "machine", machine.machineId, parsed.data);

    let simulator: { ok: boolean; reason?: string; reused?: boolean } | undefined;
    // Only a SIMULATOR machine is a container we can start; a Modbus/manual
    // machine has nothing to spin up — the config just sits waiting for a
    // real Gateway to poll it.
    if (parsed.data.dataSource === "SIMULATOR") {
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

// Physical machine registration — the real-factory counterpart to the
// simulator's self-register above. A person types in the Gateway + Modbus
// addressing (there's no container to boot and nothing self-registers),
// and the config sits waiting for a Gateway to poll it and publish MQTT
// under this machineId. See README "ขั้นตอนลงทะเบียนเครื่องจริง".
adminRouter.post("/admin/machines/manual-register", async (req, res) => {
  const parsed = manualRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { assetId, connectionType, gatewayId, modbusSlaveId, modbusIp, modbusPort, registerMap, createdBy } =
    parsed.data;

  const asset = await prisma.erpMachineAsset.findUnique({ where: { assetId } });
  if (!asset) {
    res.status(404).json({ error: `no ERP asset ${assetId} — add it in ERP first` });
    return;
  }
  const gateway = await prisma.gateway.findUnique({ where: { gatewayId } });
  if (!gateway) {
    res.status(404).json({ error: `gateway ${gatewayId} not found` });
    return;
  }

  const conflictMachineId = await findSlaveIdConflict(gatewayId, modbusSlaveId);
  if (conflictMachineId) {
    res.status(400).json({
      error: `Modbus slave ID ${modbusSlaveId} on gateway ${gatewayId} is already used by machine ${conflictMachineId}`,
    });
    return;
  }

  try {
    const machine = await prisma.machine.create({
      data: {
        machineId: assetId,
        dataSource: CONNECTION_TO_DATA_SOURCE[connectionType as ConnectionType],
        createdBy,
        connectionConfig: {
          create: {
            connectionType,
            gatewayId,
            modbusSlaveId,
            modbusIp: modbusIp ?? null,
            modbusPort: modbusPort ?? null,
            registerMap: registerMap ?? Prisma.JsonNull,
          },
        },
      },
      include: { asset: true, connectionConfig: true },
    });
    await logAudit("admin-ui", "MACHINE_MANUAL_REGISTERED", "machine", machine.machineId, {
      connectionType,
      gatewayId,
      modbusSlaveId,
    });
    res.status(201).json(flattenAsset(machine));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Either the assetId is already a machine, or the (gateway, slave) pair
      // raced past the pre-check above into the DB unique index.
      const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]).join(",") : "";
      if (target.includes("modbus_slave_id")) {
        res.status(400).json({
          error: `Modbus slave ID ${modbusSlaveId} on gateway ${gatewayId} is already in use`,
        });
        return;
      }
      res.status(409).json({ error: "this ERP asset is already registered as a machine" });
      return;
    }
    throw err;
  }
});

adminRouter.get("/admin/machines", async (_req, res) => {
  const machines = await prisma.machine.findMany({
    orderBy: { createdAt: "desc" },
    include: { asset: true, connectionConfig: true },
  });

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
    include: { asset: true, connectionConfig: true },
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
  if (machine.dataSource === "SIMULATOR") {
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
