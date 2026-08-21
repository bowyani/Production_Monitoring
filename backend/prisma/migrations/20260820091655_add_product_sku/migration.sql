-- CreateTable
CREATE TABLE "product_skus" (
    "product_code" TEXT NOT NULL,
    "description" TEXT,
    "unit_price_thb" DECIMAL(10,2) NOT NULL,
    "material_cost_per_unit_thb" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("product_code")
);

-- Seed mock ERP pricing for the SKUs the simulator produces out of the box,
-- so Executive KPI / ERP views have something to show on a fresh install
-- without a manual pricing step. Illustrative THB figures only.
INSERT INTO "product_skus" ("product_code", "description", "unit_price_thb", "material_cost_per_unit_thb", "updated_at") VALUES
    ('PVC-90-ELBOW', 'PVC Elbow 90° 1"', 12.50, 5.20, CURRENT_TIMESTAMP),
    ('PVC-110-TEE', 'PVC Tee 110mm', 18.00, 7.80, CURRENT_TIMESTAMP),
    ('PVC-63-COUPLING', 'PVC Coupling 63mm', 9.00, 3.60, CURRENT_TIMESTAMP)
ON CONFLICT ("product_code") DO NOTHING;
