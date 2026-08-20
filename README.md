# Production Monitoring

Prototype ระบบ Production Monitoring สำหรับเครื่อง Injection Molding ตามโจทย์ใน [`Direction.md.md`](Direction.md.md) — จำลองเครื่องจักร 3+ เครื่องด้วย Machine Simulator, ส่งข้อมูลผ่าน MQTT, เก็บลง PostgreSQL, และแสดงผลผ่าน Dashboard (Operator / Historical / Executive KPI / Admin)

อ่าน [`BACKGROUND.md`](BACKGROUND.md) ก่อนถ้าไม่คุ้นเคยกับศัพท์ Automation/IT-OT — อธิบายพื้นฐานไว้ให้แล้ว

---

## Quick Start

ต้องมี [Docker Desktop](https://www.docker.com/products/docker-desktop/) เท่านั้น

```bash
cp .env.example .env
docker compose up -d
```

คำสั่งเดียวจะสร้างและรันครบทั้งระบบ: Mosquitto, PostgreSQL (migrate schema อัตโนมัติ), Backend, Dashboard, และ Machine Simulator 3 เครื่อง (`IMM-01`, `IMM-02`, `IMM-03`) ที่ลงทะเบียนตัวเองและเริ่ม publish ข้อมูลทันที ไม่ต้องตั้งค่าอะไรเพิ่ม

- Dashboard: http://localhost:5173 (Operator / History / Executive KPI / Admin)
- Backend REST API: http://localhost:3000/api/v1
- Backend health check: http://localhost:3000/health

```bash
docker compose ps                    # ดูสถานะ container ทั้งหมด
docker compose logs -f backend       # ดู log แบบ real-time ของ service ไหนก็ได้
docker compose down                  # หยุดระบบ (เก็บข้อมูลไว้ใน volume)
docker compose down -v               # หยุด + ล้างข้อมูลทั้งหมด (เริ่มใหม่จากศูนย์)
```

**เพิ่มเครื่องจักรเครื่องที่ 4+**: ลงทะเบียนผ่านหน้า Admin ก่อน (แค่สร้าง record ยังไม่มีข้อมูลไหลเข้า) แล้วรัน simulator instance ผูกกับ ID นั้น — คำสั่งเต็มอยู่ในหน้า Admin เอง เช่น
```bash
docker compose run -d --rm --name simulator-IMM-04 \
  -e MACHINE_ID=IMM-04 -e MACHINE_NAME="Injection Molding Machine 04" \
  -e MQTT_BROKER_URL=mqtt://mosquitto:1883 -e BACKEND_API_URL=http://backend:3000/api/v1 \
  simulator-01
```

---

## Technology ที่เลือกใช้และเหตุผล

| ส่วน | เทคโนโลยี | ทำไม |
|---|---|---|
| Machine Simulator | Node.js + `mqtt.js` (TypeScript) | เขียนสั้น เชื่อม MQTT ตรงไปตรงมา, ใช้ runtime เดียวกับ backend ลด context switch |
| Message Broker | Mosquitto (MQTT) | event-driven แทน REST polling — latency ต่ำกว่า, จำลอง OFFLINE ได้เนียนด้วยการหยุด publish ตรงๆ, เป็น pattern มาตรฐานของ IIoT |
| Backend | Node.js + TypeScript + Express | type-safe, ecosystem MQTT/WebSocket ครบ, ทีมเล็กดูแลง่าย |
| Validation | Zod | validate payload จาก MQTT/REST ก่อนเข้า DB แบบ type-safe |
| ORM / Migration | Prisma | migration แบบ versioned (up/down) commit เข้า repo ได้ — สำคัญเพราะระบบรันคู่กับสายการผลิตจริง deploy พลาดมีต้นทุนสูง |
| Database | PostgreSQL เดียว (ไม่ใช้ time-series DB แยก) | ที่ระดับ 3-10 เครื่อง ข้อมูลยังน้อย DB เดียวดูแลง่ายกว่าและ join กับ job/alarm ได้สะดวก — ดูหัวข้อ [scaling ไป 200 เครื่อง](#แนวทางขยายจาก-3-เครื่องไปยัง-200-เครื่อง) ว่าทำไมยังปลอดภัยตอนขยาย |
| Real-time push | WebSocket (`ws`) | ให้ dashboardอัปเดตสดตอน demo (เครื่องเปลี่ยน ALARM ปุ๊บ จอเปลี่ยนปั๊บ) แทนที่จะ poll REST เอง |
| Dashboard | React + Vite + TypeScript | เขียนเร็ว, HMR ระหว่าง dev, type-safe ร่วมกับ backend ผ่าน shared payload shape |

เหตุผลเชิงลึกกว่านี้ (เทียบกับทางเลือกอื่นที่พิจารณาแล้วไม่เลือก) อยู่ใน [`DESIGN_RATIONALE.md`](DESIGN_RATIONALE.md) §5

---

## Database Structure

PostgreSQL, 5 ตาราง (normalize ไม่ denormalize — join ได้ถูกต้อง ขยาย field ง่ายกว่าระยะยาว):

| ตาราง | ใช้เก็บ | Field สำคัญ |
|---|---|---|
| `machines` | รายชื่อเครื่องจักรที่ลงทะเบียน + สถานะล่าสุด (cache) | `machine_id` (PK), `status`, `last_seen_at`, `is_active`, `machine_rated_power_kw`, `labor_cost_per_hour`, `target_cycle_time_sec` |
| `machine_telemetry` | Time-series ของทุก tick ที่ส่งเข้ามา | `machine_id` (FK), `timestamp`, `status`, `cycle_time_sec`, `shot_count`, `injection_pressure_bar`, `barrel_temperature_c` |
| `machine_status_events` | ประวัติการเปลี่ยนสถานะทุกครั้ง (audit trail) | `machine_id` (FK), `from_status`, `to_status`, `changed_at` |
| `production_jobs` | งานผลิตแต่ละ Job | `job_number` (PK), `machine_id` (FK), `product_code`, `mold_id`, `recipe_id`, `good_qty`, `reject_qty`, `startup_scrap_qty`, `status` |
| `alarms` | Alarm ที่เกิดขึ้น | `machine_id` (FK), `job_number` (FK nullable), `alarm_code`, `alarm_message`, `alarm_timestamp`, `cleared_timestamp` |

Schema เต็ม: [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) — migration ทุกไฟล์ commit อยู่ใน `backend/prisma/migrations/` รัน rollback/ดูประวัติได้ปกติ

---

## API / Message Format

### MQTT (Simulator → Backend)

Topic: `factory/{machineId}/telemetry` | `factory/{machineId}/job` | `factory/{machineId}/alarm`
Backend subscribe ด้วย wildcard `factory/+/...` ครั้งเดียวตอน start — เพิ่มเครื่องใหม่ไม่ต้อง redeploy

ทุก payload มี `schemaVersion` และจัดกลุ่ม field เป็น `machineData` / `processData` / `jobData` / `alarmData` (เผื่อ map เข้ามาตรฐาน EUROMAP 77 ในอนาคต) ตัวอย่าง telemetry:

```json
{
  "schemaVersion": "1.0",
  "machineId": "IMM-01",
  "timestamp": "2026-08-20T10:00:00Z",
  "machineData": { "status": "RUN" },
  "processData": { "cycleTimeSec": 12.4, "shotCount": 1345, "injectionPressureBar": 850, "barrelTemperatureC": 220.5 }
}
```

เครื่องที่ยังไม่ลงทะเบียนใน `machines` (หรือถูก deactivate) จะถูก reject — ไม่ auto-register

### REST API (`/api/v1`, Backend → Dashboard)

| Endpoint | ใช้ทำอะไร |
|---|---|
| `GET /machines` | สถานะล่าสุดทุกเครื่อง (active เท่านั้น) |
| `GET /machines/:id/history?from=&to=` | Telemetry ย้อนหลังตามช่วงเวลา |
| `GET /machines/:id/events?from=&to=` | ประวัติเปลี่ยนสถานะตามช่วงเวลา |
| `GET /machines/:id/alarms?from=&to=` | ประวัติ Alarm ของเครื่องตามช่วงเวลา |
| `GET /jobs?machineId=&q=&limit=` | List/ค้นหา Job (partial match) |
| `GET /jobs/:jobNumber` | รายละเอียด Job + Alarm ที่เกิดระหว่างงานนั้น |
| `GET /alarms/active` | Alarm ที่ active อยู่ทั้งโรงงาน |
| `GET /kpi/summary?from=&to=` | OEE, Availability/Performance/Quality, Reject Rate, Est. Energy/Labor Cost |
| `GET /admin/machines`, `POST /admin/machines`, `PATCH /admin/machines/:id` | ลงทะเบียน/แก้ไข/เปิด-ปิดเครื่องจักร |
| `WS /live` | push telemetry/job/alarm/status event แบบ real-time |

รายละเอียดเหตุผลการออกแบบ API/Schema เต็มๆ: [`DESIGN_RATIONALE.md`](DESIGN_RATIONALE.md) §3-4

---

## สมมติฐานและข้อจำกัด

- เครื่องจักรต้องลงทะเบียนผ่าน Admin API ก่อนเสมอ ระบบจะไม่ auto-register จาก MQTT — Simulator เรียก Admin API เพื่อลงทะเบียนตัวเองตอนเริ่มทำงาน จำลองขั้นตอน commissioning ของช่างเทคนิคจริง
- Job Number มาจากระบบภายนอก (สมมติว่าเป็น ERP) — ระบบ Monitoring บันทึกผลเทียบกับ Job ที่มีอยู่แล้วเท่านั้น ไม่มีหน้า mock-ERP แยก
- OFFLINE ตรวจจับด้วย watchdog (เช็ค `last_seen_at` ทุก 5 วิ, threshold ปรับได้ผ่าน env) ไม่ใช่ MQTT Last Will เพราะโจทย์คือเครื่อง "หยุดส่งข้อมูล" ไม่ใช่ "ตัดการเชื่อมต่อ"
- Deactivate เครื่องจักรใน Admin = หยุดรับ telemetry จาก MQTT (status → `INACTIVE`) แต่ไม่ได้สั่งเครื่องจริงหยุดทำงาน — คนละเรื่องกับ Emergency Stop ที่ต้องเป็น hardwired safety circuit แยกอิสระ (ดู [`FUTURE_VISION_UNMANNED_OPERATION.md`](FUTURE_VISION_UNMANNED_OPERATION.md))
- QC Hold Rate ใน Executive KPI **ไม่ได้ทำ** — ไม่มี concept "QC hold" ใน data model ปัจจุบัน ไม่ใส่เลขปลอมมาแสดง
- Performance/OEE ต่อเครื่องจะว่าง (`—`) จนกว่าจะตั้งค่า Target Cycle Time ในหน้า Admin — ไม่ default ค่าเดาเอง

การวิเคราะห์ gap แบบละเอียด (มุมธุรกิจ/ซอฟต์แวร์/วิศวกรรมไฟฟ้า-ความปลอดภัย) พร้อมมาตรฐานอ้างอิง: [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md)

---

## แนวทางขยายจาก 3 เครื่องไปยัง 200 เครื่อง

| ประเด็น | สถานะตอนนี้ (3 เครื่อง) | ทางขยับไป 200 เครื่อง |
|---|---|---|
| รับข้อมูลเครื่องใหม่ | Admin API/UI + MQTT wildcard subscription — เพิ่มได้ทันทีไม่ redeploy | เหมือนเดิม รองรับอยู่แล้ว ไม่ต้องแก้โค้ด |
| Database เก็บ telemetry | PostgreSQL ตารางเดียว, index บน `(machine_id, timestamp)` | ที่ 200 เครื่อง เก็บทุก 2 วิ ≈ **8.6 ล้านแถว/วัน** — ต้องทำ **table partitioning by time** หรือย้ายไป **TimescaleDB** (เป็น extension บน Postgres ตัวเดิม ย้ายได้โดยแทบไม่แก้โค้ด backend) พร้อม retention policy (aggregate ข้อมูลเก่าเป็นค่าเฉลี่ยรายชั่วโมงแล้ว archive) |
| Backup | `pg_dump` ตาม schedule | ต้องใช้ **read replica** แยก I/O สำหรับ backup ไม่ให้แย่งกับ write path หลักที่รับข้อมูลสด |
| เครื่องจักรที่เชื่อมต่อไม่ได้ | สมมติว่าเชื่อมได้ทั้งหมด | โรงงานจริงมีเครื่องเก่าที่เชื่อมไม่ได้ปนอยู่ — ต้องมี manual data entry fallback |
| IT/OT Network | Backend รันในเครือข่ายเดียวกับ dashboard (prototype) | แยกผ่าน **Industrial DMZ** ตาม Purdue Model — OT (PLC/Simulator) ไม่เปิดให้ IT เข้าตรง ต้องผ่านด่านกลางนี้เสมอ (ระบบตอนนี้ถูกออกแบบให้อยู่ตำแหน่งด่านนี้พอดีอยู่แล้ว) |
| สิทธิ์ผู้ใช้งาน | ไม่มี auth เลยใน prototype | ต้องแยก role: Operator เห็นเฉพาะเครื่องที่ดูแล / Line Supervisor เห็นภาพรวมไลน์ / Maintenance เข้า OT zone / Management เข้า Executive dashboard ผ่าน IT zone / System Admin เข้า Industrial DMZ ผ่าน MFA + audit log |
| Field-level protocol | Simulator สวมบทบาทแทน PLC ทั้งก้อน ไม่มี Modbus จริง | เชื่อม PLC จริงผ่าน Modbus RTU/TCP หรือ OPC UA (มาตรฐาน EUROMAP 77 สำหรับ Injection Molding) — มีข้อจำกัดเรื่อง torn read, register limit (125 ต่อ request) ที่ต้องจัดการเพิ่ม |

รายละเอียดเต็ม (รวมมาตรฐานอ้างอิงแต่ละข้อ): [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) §1, §3 และวิสัยทัศน์ระยะยาวกว่านั้น (Level 3 MES → unmanned operation): [`FUTURE_VISION_UNMANNED_OPERATION.md`](FUTURE_VISION_UNMANNED_OPERATION.md)

---

## โครงสร้าง Repo

```
simulator/    Machine Simulator (Node.js + mqtt.js) — จำลองเครื่องฉีดพลาสติกหลาย instance
backend/      Node.js/TypeScript — MQTT subscriber + REST API v1 + WebSocket + Prisma/PostgreSQL
dashboard/    React + Vite — Operator / History / Executive KPI / Admin views
mosquitto/    ค่าตั้งค่า MQTT broker
architecture_diagram.svg   Architecture diagram (deliverable ข้อ 1)
```

## เอกสารอื่นที่เกี่ยวข้อง

- [`Direction.md.md`](Direction.md.md) — โจทย์ต้นฉบับ
- [`BACKGROUND.md`](BACKGROUND.md) — พื้นฐาน Automation Pyramid, IT/OT Convergence (อ่านก่อนถ้าไม่คุ้นเคยกับศัพท์)
- [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) — วิเคราะห์ช่องว่างของโจทย์ ทั้งมุมธุรกิจ/ซอฟต์แวร์/วิศวกรรมไฟฟ้า พร้อมมาตรฐานอ้างอิง
- [`DESIGN_RATIONALE.md`](DESIGN_RATIONALE.md) — สถาปัตยกรรม, Database Schema, MQTT/REST payload พร้อมเหตุผลการออกแบบเทียบกับทางเลือกอื่น
- [`FUTURE_VISION_UNMANNED_OPERATION.md`](FUTURE_VISION_UNMANNED_OPERATION.md) — วิสัยทัศน์ระยะยาวสู่ Unmanned Operation พร้อมข้อจำกัดด้านความปลอดภัย
