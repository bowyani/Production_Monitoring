-- CreateTable
CREATE TABLE "erp_machine_assets" (
    "asset_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "machine_model" TEXT,
    "rated_power_kw" DECIMAL(8,2),
    "labor_cost_per_hour" DECIMAL(10,2),
    "target_cycle_time_sec" DECIMAL(6,2),
    "maintenance_interval_hours" DECIMAL(8,2),
    "vendor_name" TEXT,
    "purchase_date" TIMESTAMP(3),
    "location" TEXT,
    "manufacturer_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_machine_assets_pkey" PRIMARY KEY ("asset_id")
);

-- Backfill: one ErpMachineAsset row per existing machine, carrying over its
-- current name/model/spec fields, before those columns are dropped from
-- "machines" below. This is a one-time migration of pre-existing data, not
-- an ongoing sync — after this, ErpMachineAsset is the only place these
-- fields are written.
INSERT INTO "erp_machine_assets" (
    "asset_id", "machine_name", "machine_model", "rated_power_kw", "labor_cost_per_hour",
    "target_cycle_time_sec", "maintenance_interval_hours", "vendor_name", "purchase_date",
    "location", "manufacturer_phone", "created_at", "updated_at"
)
SELECT
    "machine_id", "machine_name", "machine_model", "machine_rated_power_kw", "labor_cost_per_hour",
    "target_cycle_time_sec", "maintenance_interval_hours", "vendor_name", "purchase_date",
    "location", "manufacturer_phone", "created_at", CURRENT_TIMESTAMP
FROM "machines";

-- AlterTable
ALTER TABLE "machines"
    DROP COLUMN "machine_name",
    DROP COLUMN "machine_model",
    DROP COLUMN "machine_rated_power_kw",
    DROP COLUMN "labor_cost_per_hour",
    DROP COLUMN "target_cycle_time_sec",
    DROP COLUMN "maintenance_interval_hours",
    DROP COLUMN "vendor_name",
    DROP COLUMN "purchase_date",
    DROP COLUMN "location",
    DROP COLUMN "manufacturer_phone";

-- AddForeignKey: machines.machine_id doubles as the FK to its asset record
-- (shared primary key 1:1) — a Machine cannot exist without a backing asset.
ALTER TABLE "machines" ADD CONSTRAINT "machines_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "erp_machine_assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
