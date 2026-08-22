import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { logAudit } from "../audit";
import { getSimulatorParams, publishSimulatorControl } from "../mqtt/subscriber";

export const simulatorControlRouter = Router();

// Mirrors simulator/src/index.ts's Tuning type — every field optional since
// callers only send the ones actually changing. This is the one validated,
// audited path onto the simulator's MQTT control channel — every other route
// that wants to push a live tuning change (e.g. ERP's Startup Scrap field,
// Admin's container-activation sync) must go through pushSimulatorTuning
// below rather than calling publishSimulatorControl directly.
const tuningPatchSchema = z
  .object({
    tickMs: z.number().min(200).max(10000),
    silentProbability: z.number().min(0).max(1),
    alarmProbability: z.number().min(0).max(1),
    rejectProbability: z.number().min(0).max(1),
    cycleTimeMinSec: z.number().min(1).max(120),
    cycleTimeMaxSec: z.number().min(1).max(120),
    pressureMinBar: z.number().min(0).max(3000),
    pressureMaxBar: z.number().min(0).max(3000),
    temperatureMinC: z.number().min(0).max(500),
    temperatureMaxC: z.number().min(0).max(500),
    startupScrapQty: z.number().int().min(0).max(1000),
  })
  .partial();

type PushTuningResult =
  | { ok: true; applied: Record<string, number> }
  | { ok: false; status: number; body: { error: unknown } };

// Validates, publishes (retained, merged onto the simulator's last-known
// state — see publishSimulatorControl), and audit-logs a tuning patch. The
// single entry point onto the control channel so every caller gets the same
// schema validation and the same SIMULATOR_PARAMS_UPDATED audit trail,
// whether the change came from a human editing Simulator Tuning directly or
// from another route syncing an ERP-configured value.
export async function pushSimulatorTuning(
  machineId: string,
  patch: Record<string, unknown>,
  actor: string
): Promise<PushTuningResult> {
  const parsed = tuningPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: parsed.error.flatten() } };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, status: 400, body: { error: "no fields to update" } };
  }
  const published = publishSimulatorControl(machineId, parsed.data);
  if (!published) {
    return { ok: false, status: 503, body: { error: "mqtt broker not connected" } };
  }
  await logAudit(actor, "SIMULATOR_PARAMS_UPDATED", "machine", machineId, parsed.data);
  return { ok: true, applied: parsed.data };
}

type SimulatedMachineCheck =
  | { ok: true }
  | { ok: false; status: number; body: { error: string } };

async function requireSimulatedMachine(machineId: string): Promise<SimulatedMachineCheck> {
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (!machine) return { ok: false, status: 404, body: { error: "machine not found" } };
  if (machine.dataSource !== "MQTT") {
    return { ok: false, status: 400, body: { error: "only MQTT/simulator-backed machines have tunable params" } };
  }
  return { ok: true };
}

simulatorControlRouter.get("/admin/machines/:id/simulator/params", async (req, res) => {
  const check = await requireSimulatedMachine(req.params.id);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }
  const cached = getSimulatorParams(req.params.id);
  res.json({ machineId: req.params.id, tuning: cached?.tuning ?? null });
});

simulatorControlRouter.patch("/admin/machines/:id/simulator/params", async (req, res) => {
  const check = await requireSimulatedMachine(req.params.id);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }
  const result = await pushSimulatorTuning(req.params.id, req.body, "admin-ui");
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.json({ ok: true, applied: result.applied });
});
