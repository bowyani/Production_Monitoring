import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { logAudit } from "../audit";

// Protocol Gateway registry (see schema.prisma Gateway). A prototype backed
// only by simulator containers has no gateways; this is the CRUD an Admin
// uses when a real PLC has to be reached over Modbus instead — the machine's
// MachineConnectionConfig then points at one of these rows. Kept deliberately
// small: a real deployment would drive `status` from a heartbeat watchdog
// (same idea as watchdog.ts), here it's set by hand.
export const gatewaysRouter = Router();

const createGatewaySchema = z.object({
  ipAddress: z.string().min(1),
  location: z.string().min(1),
  status: z.enum(["ONLINE", "OFFLINE"]).optional(),
  lastHeartbeatAt: z.coerce.date().optional(),
});

const patchGatewaySchema = z
  .object({
    ipAddress: z.string().min(1),
    location: z.string().min(1),
    status: z.enum(["ONLINE", "OFFLINE"]),
    lastHeartbeatAt: z.coerce.date().nullable(),
  })
  .partial();

// `online` is derived so the UI's status dot doesn't have to trust a stale
// stored `status` — a gateway that hasn't reported within the window reads
// as offline regardless of what was last written.
const HEARTBEAT_FRESH_MS = 60_000;
function serialiseGateway<T extends { lastHeartbeatAt: Date | null; status: string }>(gateway: T) {
  const fresh =
    gateway.lastHeartbeatAt != null && Date.now() - gateway.lastHeartbeatAt.getTime() < HEARTBEAT_FRESH_MS;
  return { ...gateway, online: gateway.status === "ONLINE" && fresh };
}

gatewaysRouter.post("/admin/gateways", async (req, res) => {
  const parsed = createGatewaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const gateway = await prisma.gateway.create({ data: parsed.data });
  await logAudit("admin-ui", "GATEWAY_CREATED", "gateway", gateway.gatewayId, parsed.data);
  res.status(201).json(serialiseGateway(gateway));
});

gatewaysRouter.get("/admin/gateways", async (_req, res) => {
  const gateways = await prisma.gateway.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { connections: true } } },
  });
  res.json(
    gateways.map(({ _count, ...g }) => ({ ...serialiseGateway(g), machineCount: _count.connections }))
  );
});

gatewaysRouter.patch("/admin/gateways/:id", async (req, res) => {
  const parsed = patchGatewaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const gateway = await prisma.gateway.update({ where: { gatewayId: req.params.id }, data: parsed.data });
    await logAudit("admin-ui", "GATEWAY_UPDATED", "gateway", gateway.gatewayId, parsed.data);
    res.json(serialiseGateway(gateway));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({ error: `gateway ${req.params.id} not found` });
      return;
    }
    throw err;
  }
});

// Blocked while any machine still points at this gateway — the FK is ON
// DELETE SET NULL, so an unchecked delete would silently orphan those
// machines' Modbus configs (gateway_id -> null) rather than error. Same
// "unregister the dependants first" rule as ERP machine-asset deletes.
gatewaysRouter.delete("/admin/gateways/:id", async (req, res) => {
  const inUse = await prisma.machineConnectionConfig.count({ where: { gatewayId: req.params.id } });
  if (inUse > 0) {
    res.status(409).json({
      error: `gateway ${req.params.id} still has ${inUse} machine(s) bound to it — reassign or remove them first`,
    });
    return;
  }
  try {
    await prisma.gateway.delete({ where: { gatewayId: req.params.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({ error: `gateway ${req.params.id} not found` });
      return;
    }
    throw err;
  }
  await logAudit("admin-ui", "GATEWAY_REMOVED", "gateway", req.params.id, null);
  res.status(204).end();
});

// Atomic "create with this exact id if new, otherwise just touch ip/location"
// — the mock-gateway's own self-register on boot (see mock-gateway/src/index.ts),
// the gateway counterpart to the simulator's ERP-asset bootstrap. Uses the
// DB's unique constraint as the existence check so there's no GET-then-write
// race. Unlike the CRUD create above, the caller supplies the id.
const bootstrapGatewaySchema = z.object({
  ipAddress: z.string().min(1),
  location: z.string().min(1),
});

gatewaysRouter.post("/admin/gateways/:id/bootstrap", async (req, res) => {
  const parsed = bootstrapGatewaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const gatewayId = req.params.id;
  try {
    const gateway = await prisma.gateway.create({ data: { gatewayId, ...parsed.data } });
    await logAudit("gateway", "GATEWAY_BOOTSTRAPPED", "gateway", gatewayId, parsed.data);
    res.status(201).json(serialiseGateway(gateway));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const gateway = await prisma.gateway.update({ where: { gatewayId }, data: parsed.data });
      res.json(serialiseGateway(gateway));
      return;
    }
    throw err;
  }
});

// Liveness ping from the gateway itself. Stamps the heartbeat and, on the
// OFFLINE -> ONLINE edge only, flips status + writes one audit line (so a
// gateway pinging every few seconds doesn't flood the audit log). The
// watchdog does the reverse edge — see watchdog.ts.
gatewaysRouter.post("/admin/gateways/:id/heartbeat", async (req, res) => {
  const existing = await prisma.gateway.findUnique({ where: { gatewayId: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: `gateway ${req.params.id} not found` });
    return;
  }
  const cameOnline = existing.status !== "ONLINE";
  const gateway = await prisma.gateway.update({
    where: { gatewayId: req.params.id },
    data: { lastHeartbeatAt: new Date(), status: "ONLINE" },
  });
  if (cameOnline) {
    await logAudit("gateway", "GATEWAY_ONLINE", "gateway", gateway.gatewayId, {
      previousStatus: existing.status,
    });
  }
  res.json(serialiseGateway(gateway));
});

gatewaysRouter.get("/admin/gateways/:id/machines", async (req, res) => {
  const gateway = await prisma.gateway.findUnique({ where: { gatewayId: req.params.id } });
  if (!gateway) {
    res.status(404).json({ error: `gateway ${req.params.id} not found` });
    return;
  }
  const configs = await prisma.machineConnectionConfig.findMany({
    where: { gatewayId: req.params.id },
    orderBy: { modbusSlaveId: "asc" },
    include: { machine: { include: { asset: true } } },
  });
  res.json(
    configs.map((c) => ({
      machineId: c.machineId,
      machineName: c.machine.asset.machineName,
      connectionType: c.connectionType,
      modbusSlaveId: c.modbusSlaveId,
      modbusIp: c.modbusIp,
      modbusPort: c.modbusPort,
      registerMap: c.registerMap,
      isActive: c.machine.isActive,
      status: c.machine.status,
    }))
  );
});
