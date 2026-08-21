import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { logAudit } from "../audit";
import type { ErpMachineAsset, ProductSku, ProductionJob } from "@prisma/client";

// Mock ERP (Level 4) view over the production data this system already has.
// There is no real ERP integration — this is a small admin-editable price
// book (ProductSku) that lets Job Orders be priced so revenue/cost/margin
// can be shown to executives, per README Automation Pyramid (§ "Level 4: ERP").
export const erpRouter = Router();

const upsertSkuSchema = z.object({
  description: z.string().optional(),
  unitPriceThb: z.number().nonnegative(),
  materialCostPerUnitThb: z.number().nonnegative().optional(),
});

erpRouter.get("/erp/skus", async (_req, res) => {
  const skus = await prisma.productSku.findMany({ orderBy: { productCode: "asc" } });
  res.json(skus);
});

erpRouter.put("/erp/skus/:productCode", async (req, res) => {
  const parsed = upsertSkuSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const productCode = req.params.productCode;
  const sku = await prisma.productSku.upsert({
    where: { productCode },
    create: { productCode, ...parsed.data },
    update: { ...parsed.data },
  });
  await logAudit("erp-ui", "SKU_PRICE_SET", "product_sku", productCode, parsed.data);
  res.json(sku);
});

erpRouter.delete("/erp/skus/:productCode", async (req, res) => {
  await prisma.productSku.delete({ where: { productCode: req.params.productCode } }).catch(() => null);
  await logAudit("erp-ui", "SKU_PRICE_REMOVED", "product_sku", req.params.productCode, null);
  res.status(204).end();
});

// ERP master data for machine assets (see schema.prisma ErpMachineAsset) —
// the single source of truth for machine specs, so Admin can register a
// machine by picking an asset instead of re-typing its details.
const upsertMachineAssetSchema = z.object({
  machineName: z.string().min(1),
  machineModel: z.string().optional(),
  ratedPowerKw: z.number().nonnegative().optional(),
  laborCostPerHour: z.number().nonnegative().optional(),
  targetCycleTimeSec: z.number().positive().optional(),
  maintenanceIntervalHours: z.number().positive().optional(),
  vendorName: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  location: z.string().optional(),
  manufacturerPhone: z.string().optional(),
});

erpRouter.get("/erp/machine-assets", async (_req, res) => {
  const [assets, machines] = await Promise.all([
    prisma.erpMachineAsset.findMany({ orderBy: { assetId: "asc" } }),
    prisma.machine.findMany({ select: { machineId: true } }),
  ]);
  const registeredIds = new Set(machines.map((m) => m.machineId));
  res.json(assets.map((a) => ({ ...a, registered: registeredIds.has(a.assetId) })));
});

erpRouter.put("/erp/machine-assets/:assetId", async (req, res) => {
  const parsed = upsertMachineAssetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const assetId = req.params.assetId;
  const asset = await prisma.erpMachineAsset.upsert({
    where: { assetId },
    create: { assetId, ...parsed.data },
    update: { ...parsed.data },
  });
  await logAudit("erp-ui", "MACHINE_ASSET_SET", "erp_machine_asset", assetId, parsed.data);
  res.json(asset);
});

erpRouter.delete("/erp/machine-assets/:assetId", async (req, res) => {
  try {
    await prisma.erpMachineAsset.delete({ where: { assetId: req.params.assetId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      res.status(409).json({ error: "this asset is registered as a machine in Admin — deactivate/remove it there first" });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({ error: "asset not found" });
      return;
    }
    throw err;
  }
  await logAudit("erp-ui", "MACHINE_ASSET_REMOVED", "erp_machine_asset", req.params.assetId, null);
  res.status(204).end();
});

erpRouter.get("/erp/job-orders", async (req, res) => {
  const { from, to, machineId, productCode, limit } = req.query;
  const jobs = await prisma.productionJob.findMany({
    where: {
      machineId: machineId ? String(machineId) : undefined,
      productCode: productCode ? String(productCode) : undefined,
      startTime: {
        gte: from ? new Date(String(from)) : undefined,
        lte: to ? new Date(String(to)) : undefined,
      },
    },
    orderBy: { startTime: "desc" },
    take: limit ? Number(limit) : 100,
    include: { machine: { include: { asset: true } } },
  });

  const skus = await prisma.productSku.findMany();
  const skuByCode = new Map(skus.map((s) => [s.productCode, s]));

  res.json(jobs.map((j) => priceJobOrder(j, j.machine.asset, skuByCode.get(j.productCode))));
});

// Revenue/cost/margin by SKU and by machine over the window — the "where's
// the cost or bottleneck" view. A SKU/machine only contributes to these
// totals if it has a mock price configured; unpriced job orders are counted
// separately and surfaced so the gap is visible rather than silently
// treated as zero revenue.
erpRouter.get("/erp/summary", async (req, res) => {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const jobs = await prisma.productionJob.findMany({
    where: { startTime: { gte: from, lte: to } },
    include: { machine: { include: { asset: true } } },
  });
  const skus = await prisma.productSku.findMany();
  const skuByCode = new Map(skus.map((s) => [s.productCode, s]));

  const priced = jobs.map((j) => priceJobOrder(j, j.machine.asset, skuByCode.get(j.productCode)));
  const unpricedJobCount = priced.filter((p) => p.unitPriceThb == null).length;

  const bySku = rollUp(priced, (p) => p.productCode);
  const byMachine = rollUp(priced, (p) => `${p.machineId} — ${p.machineName}`);

  res.json({
    from,
    to,
    unpricedJobCount,
    totals: totalsOf(priced),
    bySku: bySku.sort((a, b) => (a.marginPerHourThb ?? Infinity) - (b.marginPerHourThb ?? Infinity)),
    byMachine: byMachine.sort((a, b) => (a.marginPerHourThb ?? Infinity) - (b.marginPerHourThb ?? Infinity)),
  });
});

type PricedJob = {
  jobNumber: string;
  machineId: string;
  machineName: string;
  productCode: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  goodQty: number;
  rejectQty: number;
  startupScrapQty: number;
  runtimeHours: number;
  unitPriceThb: number | null;
  materialCostPerUnitThb: number | null;
  revenueThb: number | null;
  materialCostThb: number | null;
  laborCostThb: number | null;
  marginThb: number | null;
};

function priceJobOrder(job: ProductionJob, asset: ErpMachineAsset, sku: ProductSku | undefined): PricedJob {
  const runtimeHours = ((job.endTime ?? new Date()).getTime() - job.startTime.getTime()) / 3_600_000;
  const totalQty = job.goodQty + job.rejectQty + job.startupScrapQty;

  const unitPriceThb = sku ? Number(sku.unitPriceThb) : null;
  const materialCostPerUnitThb = sku?.materialCostPerUnitThb != null ? Number(sku.materialCostPerUnitThb) : null;
  const laborCostPerHour = asset.laborCostPerHour != null ? Number(asset.laborCostPerHour) : null;

  const revenueThb = unitPriceThb != null ? job.goodQty * unitPriceThb : null;
  const materialCostThb = materialCostPerUnitThb != null ? totalQty * materialCostPerUnitThb : null;
  const laborCostThb = laborCostPerHour != null ? laborCostPerHour * Math.max(0, runtimeHours) : null;
  const marginThb =
    revenueThb != null && materialCostThb != null && laborCostThb != null
      ? revenueThb - materialCostThb - laborCostThb
      : null;

  return {
    jobNumber: job.jobNumber,
    machineId: job.machineId,
    machineName: asset.machineName,
    productCode: job.productCode,
    status: job.status,
    startTime: job.startTime,
    endTime: job.endTime,
    goodQty: job.goodQty,
    rejectQty: job.rejectQty,
    startupScrapQty: job.startupScrapQty,
    runtimeHours,
    unitPriceThb,
    materialCostPerUnitThb,
    revenueThb,
    materialCostThb,
    laborCostThb,
    marginThb,
  };
}

function totalsOf(jobs: PricedJob[]) {
  const revenueThb = sumNullable(jobs.map((j) => j.revenueThb));
  const materialCostThb = sumNullable(jobs.map((j) => j.materialCostThb));
  const laborCostThb = sumNullable(jobs.map((j) => j.laborCostThb));
  const marginThb = sumNullable(jobs.map((j) => j.marginThb));
  const runtimeHours = jobs.reduce((a, j) => a + j.runtimeHours, 0);
  const rejectQty = jobs.reduce((a, j) => a + j.rejectQty, 0);
  const goodQty = jobs.reduce((a, j) => a + j.goodQty, 0);
  return {
    goodQty,
    rejectQty,
    revenueThb,
    materialCostThb,
    laborCostThb,
    marginThb,
    marginPerHourThb: marginThb != null && runtimeHours > 0 ? marginThb / runtimeHours : null,
  };
}

function rollUp(jobs: PricedJob[], keyOf: (j: PricedJob) => string) {
  const groups = new Map<string, PricedJob[]>();
  for (const j of jobs) {
    const key = keyOf(j);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(j);
  }
  return [...groups.entries()].map(([key, groupJobs]) => ({
    key,
    jobCount: groupJobs.length,
    ...totalsOf(groupJobs),
    // Rejected/scrap units consumed material but earned no revenue — this is
    // the "hidden cost" figure that a pure revenue view would miss.
    rejectMaterialLossThb: sumNullable(
      groupJobs.map((j) =>
        j.materialCostPerUnitThb != null ? j.rejectQty * j.materialCostPerUnitThb : null
      )
    ),
  }));
}

function sumNullable(values: (number | null)[]) {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}
