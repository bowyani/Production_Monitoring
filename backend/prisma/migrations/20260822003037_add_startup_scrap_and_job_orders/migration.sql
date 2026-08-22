-- AlterTable
ALTER TABLE "erp_machine_assets" ADD COLUMN     "startup_scrap_qty" INTEGER DEFAULT 3;

-- CreateTable
CREATE TABLE "erp_job_orders" (
    "job_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_job_orders_pkey" PRIMARY KEY ("job_number")
);
