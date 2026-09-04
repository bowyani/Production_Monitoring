-- CreateTable
CREATE TABLE "gateways" (
    "gateway_id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("gateway_id")
);

-- CreateTable
CREATE TABLE "machine_connection_configs" (
    "machine_id" TEXT NOT NULL,
    "connection_type" TEXT NOT NULL,
    "gateway_id" TEXT,
    "modbus_slave_id" INTEGER,
    "modbus_ip" TEXT,
    "modbus_port" INTEGER,
    "register_map" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_connection_configs_pkey" PRIMARY KEY ("machine_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_connection_configs_gateway_id_modbus_slave_id_key" ON "machine_connection_configs"("gateway_id", "modbus_slave_id");

-- AddForeignKey
ALTER TABLE "machine_connection_configs" ADD CONSTRAINT "machine_connection_configs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_connection_configs" ADD CONSTRAINT "machine_connection_configs_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("gateway_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backward-compatible data_source remap. Every machine that exists today was
-- a self-registered simulator publishing MQTT directly ("MQTT"), or a legacy
-- CSV-only machine ("MANUAL"). Move both onto the new vocabulary.
UPDATE "machines" SET "data_source" = 'SIMULATOR' WHERE "data_source" = 'MQTT';
UPDATE "machines" SET "data_source" = 'MANUAL_CSV' WHERE "data_source" = 'MANUAL';

-- AlterTable: the column default follows the rename (was 'MQTT').
ALTER TABLE "machines" ALTER COLUMN "data_source" SET DEFAULT 'SIMULATOR';

-- Backfill one connection config per existing machine so the 1:1 relation is
-- populated for rows created before this table existed. MANUAL_CSV machines
-- get a MANUAL_CSV config; everything else is a SIMULATOR.
INSERT INTO "machine_connection_configs" ("machine_id", "connection_type", "created_at", "updated_at")
SELECT
    "machine_id",
    CASE WHEN "data_source" = 'MANUAL_CSV' THEN 'MANUAL_CSV' ELSE 'SIMULATOR' END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "machines";
