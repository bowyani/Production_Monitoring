-- AlterTable
ALTER TABLE "machines" ADD COLUMN     "vendor_name" TEXT,
ADD COLUMN     "purchase_date" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "manufacturer_phone" TEXT;
