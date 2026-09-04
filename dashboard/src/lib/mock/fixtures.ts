// Static seed for the no-backend (VITE_MOCK) build. The engine grows live data
// on top of these; nothing here changes at runtime.
import type { ErpMachineAsset, Gateway, ProductSku } from "../api";

export const PRODUCT_CODES = ["PVC-90-ELBOW", "PVC-110-TEE", "PVC-63-COUPLING"] as const;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const DAY = 86_400_000;

type AssetSeed = Omit<ErpMachineAsset, "createdAt" | "updatedAt" | "registered">;

export const MACHINE_ASSETS: AssetSeed[] = [
  {
    assetId: "IMM-01",
    machineName: "Injection Molding Machine 01",
    machineModel: "Arburg Allrounder 470 A",
    ratedPowerKw: 36,
    laborCostPerHour: 242,
    targetCycleTimeSec: 12,
    maintenanceIntervalHours: 600,
    vendorName: "Thai Plastic Machinery Co.",
    purchaseDate: iso(1400 * DAY).slice(0, 10),
    location: "Building C",
    manufacturerPhone: "02-660-3361",
  },
  {
    assetId: "IMM-02",
    machineName: "Injection Molding Machine 02",
    machineModel: "Chen Hsong JM138-Ai",
    ratedPowerKw: 35,
    laborCostPerHour: 283,
    targetCycleTimeSec: 15,
    maintenanceIntervalHours: 400,
    vendorName: "Asia Injection Systems Ltd.",
    purchaseDate: iso(1400 * DAY).slice(0, 10),
    location: "Building A",
    manufacturerPhone: "02-595-8696",
  },
  {
    assetId: "IMM-03",
    machineName: "Injection Molding Machine 03",
    machineModel: "Haitian MA1200",
    ratedPowerKw: 34,
    laborCostPerHour: 220,
    targetCycleTimeSec: 14,
    maintenanceIntervalHours: 700,
    vendorName: "Asia Injection Systems Ltd.",
    purchaseDate: iso(1400 * DAY).slice(0, 10),
    location: "Building B",
    manufacturerPhone: "02-634-8735",
  },
];

export const SKUS: ProductSku[] = [
  {
    productCode: "PVC-90-ELBOW",
    description: '90mm PVC elbow, 45"',
    unitPriceThb: 18.5,
    materialCostPerUnitThb: 6.2,
    createdAt: iso(120 * DAY),
    updatedAt: iso(20 * DAY),
  },
  {
    productCode: "PVC-110-TEE",
    description: "110mm PVC equal tee",
    unitPriceThb: 42,
    materialCostPerUnitThb: 15.4,
    createdAt: iso(120 * DAY),
    updatedAt: iso(9 * DAY),
  },
  {
    productCode: "PVC-63-COUPLING",
    description: "63mm PVC straight coupling",
    unitPriceThb: 7.75,
    materialCostPerUnitThb: 2.5,
    createdAt: iso(120 * DAY),
    updatedAt: iso(33 * DAY),
  },
];

export const GATEWAYS: Gateway[] = [
  {
    gatewayId: "GW-A1",
    ipAddress: "192.168.10.11",
    location: "Building A – MDB room",
    lastHeartbeatAt: iso(15_000),
    status: "ONLINE",
    online: true,
    machineCount: 0,
    createdAt: iso(60 * DAY),
    updatedAt: iso(15_000),
  },
  {
    gatewayId: "GW-C1",
    ipAddress: "192.168.10.31",
    location: "Building C – line 3",
    lastHeartbeatAt: iso(9 * 60_000),
    status: "ONLINE",
    online: false,
    machineCount: 0,
    createdAt: iso(45 * DAY),
    updatedAt: iso(9 * 60_000),
  },
];

// Per-machine starting point for the engine.
export const MACHINE_START: Record<
  string,
  { status: string; lastMaintenanceAgoH: number }
> = {
  "IMM-01": { status: "RUN", lastMaintenanceAgoH: 180 },
  "IMM-02": { status: "RUN", lastMaintenanceAgoH: 410 },
  "IMM-03": { status: "STOP", lastMaintenanceAgoH: 95 },
};
