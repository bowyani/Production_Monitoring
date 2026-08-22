-- AlterTable
-- Startup Scrap moved from ERP master data to a Simulator Tuning parameter —
-- the only consumer was ever the simulator itself, and it now lives purely
-- in the live MQTT tuning channel alongside every other behavior knob
-- (see backend/src/api/simulatorControl.ts), not as persisted ERP data.
ALTER TABLE "erp_machine_assets" DROP COLUMN "startup_scrap_qty";
