-- CreateTable
CREATE TABLE "machines" (
    "machine_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "last_seen_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "machine_rated_power_kw" DECIMAL(8,2),
    "labor_cost_per_hour" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "machine_telemetry" (
    "id" BIGSERIAL NOT NULL,
    "machine_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "cycle_time_sec" DECIMAL(6,2),
    "shot_count" INTEGER,
    "injection_pressure_bar" DECIMAL(6,2),
    "barrel_temperature_c" DECIMAL(6,2),

    CONSTRAINT "machine_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_status_events" (
    "id" BIGSERIAL NOT NULL,
    "machine_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_jobs" (
    "job_number" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "mold_id" TEXT,
    "recipe_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "good_qty" INTEGER NOT NULL DEFAULT 0,
    "reject_qty" INTEGER NOT NULL DEFAULT 0,
    "startup_scrap_qty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "production_jobs_pkey" PRIMARY KEY ("job_number")
);

-- CreateTable
CREATE TABLE "alarms" (
    "id" BIGSERIAL NOT NULL,
    "machine_id" TEXT NOT NULL,
    "job_number" TEXT,
    "alarm_code" TEXT NOT NULL,
    "alarm_message" TEXT NOT NULL,
    "alarm_timestamp" TIMESTAMP(3) NOT NULL,
    "cleared_timestamp" TIMESTAMP(3),

    CONSTRAINT "alarms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machine_telemetry_machine_id_timestamp_idx" ON "machine_telemetry"("machine_id", "timestamp");

-- CreateIndex
CREATE INDEX "machine_status_events_machine_id_changed_at_idx" ON "machine_status_events"("machine_id", "changed_at");

-- CreateIndex
CREATE INDEX "production_jobs_machine_id_idx" ON "production_jobs"("machine_id");

-- CreateIndex
CREATE INDEX "alarms_machine_id_alarm_timestamp_idx" ON "alarms"("machine_id", "alarm_timestamp");

-- AddForeignKey
ALTER TABLE "machine_telemetry" ADD CONSTRAINT "machine_telemetry_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_status_events" ADD CONSTRAINT "machine_status_events_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_job_number_fkey" FOREIGN KEY ("job_number") REFERENCES "production_jobs"("job_number") ON DELETE SET NULL ON UPDATE CASCADE;
