# Production Monitoring

Prototype ระบบ Production Monitoring สำหรับเครื่อง Injection Molding ตามโจทย์ใน [`Direction.md.md`](Direction.md.md) — จำลองเครื่องจักร 3+ เครื่องด้วย Machine Simulator, ส่งข้อมูลผ่าน MQTT, เก็บลง PostgreSQL, และแสดงผลผ่าน Dashboard (Operator / Historical / Executive KPI / Admin)

อ่าน [`BACKGROUND.md`](BACKGROUND.md) ก่อนถ้าไม่คุ้นเคยกับศัพท์ Automation/IT-OT (Automation Pyramid, IT/OT Convergence) — อธิบายพื้นฐานไว้ให้แล้ว เอกสารนี้ (README) รวมทุกอย่างที่เหลือไว้ในไฟล์เดียว: เหตุผลการออกแบบ, gap analysis, และวิสัยทัศน์ระยะยาว

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
| Database | PostgreSQL เดียว (ไม่ใช้ time-series DB แยก) | ที่ระดับ 3-10 เครื่อง ข้อมูลยังน้อย DB เดียวดูแลง่ายกว่าและ join กับ job/alarm ได้สะดวก — ดูหัวข้อ [scaling ไป 200 เครื่อง](#แนวทางขยายจาก-3-เครื่องไปยัง-200-เครื่อง) |
| Real-time push | WebSocket (`ws`) | ให้ dashboard อัปเดตสดตอน demo (เครื่องเปลี่ยน ALARM ปุ๊บ จอเปลี่ยนปั๊บ) แทนที่จะ poll REST เอง |
| Dashboard | React + Vite + TypeScript | เขียนเร็ว, HMR ระหว่าง dev, type-safe ร่วมกับ backend ผ่าน shared payload shape |

เหตุผลเทียบกับทางเลือกอื่นที่พิจารณาแล้วไม่เลือก อยู่ในหัวข้อ [Design Rationale](#design-rationale--เหตุผลเชิงลึกเทียบกับทางเลือกอื่น) ด้านล่าง

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

Schema เต็ม: [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) — migration ทุกไฟล์ commit อยู่ใน `backend/prisma/migrations/` (generate แบบมีเลขลำดับ พร้อม track ประวัติอัตโนมัติผ่าน Prisma Migrate แทนการรัน SQL ALTER สดๆ) รัน rollback/ดูประวัติได้ปกติ

---

## API / Message Format

### MQTT (Simulator → Backend)

Topic: `factory/{machineId}/telemetry` | `factory/{machineId}/job` | `factory/{machineId}/alarm`
Backend subscribe ด้วย wildcard `factory/+/...` ครั้งเดียวตอน start — เพิ่มเครื่องใหม่ไม่ต้อง redeploy

ทุก payload มี `schemaVersion` (เช่น `"1.0"`) และออกแบบแบบ additive-only (field ใหม่ในอนาคตต้องเป็น optional ห้ามลบ/เปลี่ยนชื่อ field เดิม) เพื่อไม่ให้ consumer เก่าพังเมื่อเพิ่ม field ใหม่ เช่น multi-zone temperature — และจัดกลุ่ม field เป็น `machineData` / `processData` / `jobData` / `alarmData` เผื่อ map เข้ามาตรฐาน **EUROMAP 77** (เทียบเท่า OPC 40077) ในอนาคต ตัวอย่าง telemetry:

```json
{
  "schemaVersion": "1.0",
  "machineId": "IMM-01",
  "timestamp": "2026-08-20T10:00:00Z",
  "machineData": { "status": "RUN" },
  "processData": { "cycleTimeSec": 12.4, "shotCount": 1345, "injectionPressureBar": 850, "barrelTemperatureC": 220.5 }
}
```

เครื่องที่ยังไม่ลงทะเบียนใน `machines` (หรือถูก deactivate) จะถูก reject พร้อม log แจ้งเตือน — ไม่ auto-register ต้องลงทะเบียนผ่าน Admin ก่อนเสมอ

### REST API (`/api/v1`, Backend → Dashboard)

Prefix ทุก endpoint ด้วย `/api/v1/` เพื่อให้เพิ่ม `/api/v2/` ในอนาคตได้โดยไม่กระทบ consumer เดิม

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

---

## Design Rationale — เหตุผลเชิงลึกเทียบกับทางเลือกอื่น

**MQTT (pub/sub) แทน REST polling** — event-driven ไม่ต้องยิง request รัวๆ, latency ต่ำกว่า, จำลอง OFFLINE ได้เนียนกว่าด้วยการหยุด publish ตรงๆ, เป็น pattern มาตรฐานของ IIoT ที่ตรงกับหัวข้อ "พิจารณาเป็นพิเศษ" ในเกณฑ์ประเมิน ข้อเสีย: ต้องดูแล broker เพิ่มหนึ่งตัว และ debug ยากกว่า REST ตรงที่ทดสอบด้วย curl ตรงๆ ไม่ได้ ต้องมี MQTT client ช่วย

**PostgreSQL เดียวเก็บทั้ง telemetry และข้อมูลเชิงสัมพันธ์ แทน time-series DB เฉพาะทาง (Influx/Timescale)** — ที่ระดับ 3-10 เครื่อง ข้อมูลยังน้อย DB เดียวดูแลง่ายกว่าและ join กับ job/alarm ได้สะดวก ข้อเสีย: ถ้าขยายไป 200 เครื่องจริงตาราง telemetry จะโตเร็ว ต้อง partitioning หรือย้ายไป TimescaleDB (เป็น extension บน Postgres ย้ายทีหลังได้โดยแทบไม่แก้โค้ด backend) — ดู [scaling section](#แนวทางขยายจาก-3-เครื่องไปยัง-200-เครื่อง)

**Schema แบบ normalize 5 ตาราง แทนตารางเดียวแบบ denormalize** — สะท้อนความเข้าใจ relational design ข้อเสีย: query ต้อง join หลายตารางขึ้นเล็กน้อย แลกกับความถูกต้องของข้อมูลและขยาย field ได้ง่ายกว่าในระยะยาว

**WebSocket push แทน Dashboard polling REST เอง** — ให้ประสบการณ์ real-time จริงตอน demo สด ข้อเสีย: เพิ่มความซับซ้อนเรื่อง connection/reconnect management เทียบกับ REST polling ที่ง่ายกว่าแต่มี delay

**Backend watchdog (เช็ค `last_seen_at`) แทน MQTT Last Will Testament (LWT) สำหรับตรวจ OFFLINE** — โจทย์ระบุว่า simulator "หยุดส่งข้อมูล" ไม่ใช่ "ตัดการเชื่อมต่อ" ถ้าใช้ LWT อย่างเดียวจะจับ OFFLINE ไม่ได้ในกรณีนี้ watchdog จับได้ทุกกรณีแต่แลกกับความหน่วง (รอครบ threshold)

**Simulator ทำหน้าที่แทน ERP เปิด Job เอง แทนการสร้างหน้า mock-ERP แยก** — ตรงกับสมมติฐานว่า Job Number มาจากภายนอกอยู่แล้ว ลดความซับซ้อนให้โฟกัสที่ Monitoring เป็นหลัก ข้อเสีย: แยกขอบเขต MES/ERP ไม่ชัดเท่าของจริง

**Admin page + dynamic MQTT wildcard subscription แทนการ hardcode รายชื่อเครื่องแล้ว deploy ใหม่** — Direction.md ข้อ 7 ระบุตรงๆ ว่ากรรมการอาจขอให้ "เพิ่มเครื่องจักร" กลางการ demo สด ถ้าไม่มีความสามารถนี้จะทำ requirement ข้อนี้ไม่ผ่านทันที ข้อเสีย: ใช้เวลาพัฒนาเพิ่มขึ้นเล็กน้อยเพราะต้องทำทั้ง Admin UI และ backend ฝั่ง dynamic subscribe

**Migration tool แบบ versioned (up/down) แทนการรัน SQL ALTER สดตอน deploy** — ระบบที่รันคู่กับสายการผลิตจริง deploy พลาดมีต้นทุนสูง การมี rollback path ที่ทดสอบแล้วจึงจำเป็นกว่าเว็บทั่วไป ข้อเสีย: ต้องเรียนรู้ syntax ของ migration tool เพิ่ม

**`schemaVersion` ใน payload + API versioning (`/api/v1/`) แทนการไม่ทำ versioning เลย** — โรงงานมีเครื่องจักรหลาย Generation ใช้งานพร้อมกันเป็นปกติ การันตีว่า consumer เดิมที่อ่าน payload v1 จะไม่พังเมื่อเพิ่ม field ใหม่ในอนาคตจึงสำคัญกว่าความเรียบง่ายตอนนี้

### Crosswalk: Design ตอบ Gap ข้อไหนบ้าง

| ข้อ Gap | ประเด็น | วิธีที่ Design นี้ตอบ |
|---|---|---|
| 1.2 | Startup scrap ปนกับ reject | field `startup_scrap_qty` แยกใน `production_jobs` |
| 1.7 | เผื่อ map เข้ามาตรฐาน EUROMAP 77 | payload จัดกลุ่ม `machineData`/`jobData`/`processData`/`alarmData` |
| 2.1 | Hardcode รายชื่อเครื่อง | Admin API/GUI + MQTT wildcard subscription |
| 2.2 | Deploy พลาดต้นทุนสูง | Migration tool แบบ versioned up/down |
| 2.4 | Field ใหม่ต้องไม่ทำ consumer เดิมพัง | `schemaVersion` ในทุก payload + `/api/v1/` ใน REST API |

_ข้อ 2.5–2.7 (Modbus RTU/torn read/register limit) เป็น Future Scope เกี่ยวกับตอนเชื่อมต่อ PLC จริง — ไม่เกี่ยวกับ Prototype นี้เพราะ Machine Simulator สวมบทบาทแทน PLC ทั้งก้อน (ข้าม "PLC poll ค่าจาก sensor ผ่าน Modbus" ไป สร้างค่าเองแล้ว publish MQTT ตรง) รายละเอียดอยู่ใน Gap Analysis ด้านล่าง_

---

## สมมติฐานและข้อจำกัด

- เครื่องจักรต้องลงทะเบียนผ่าน Admin API ก่อนเสมอ ระบบจะไม่ auto-register จาก MQTT — Simulator เรียก Admin API เพื่อลงทะเบียนตัวเองตอนเริ่มทำงาน จำลองขั้นตอน commissioning ของช่างเทคนิคจริง
- Job Number มาจากระบบภายนอก (สมมติว่าเป็น ERP) — ระบบ Monitoring บันทึกผลเทียบกับ Job ที่มีอยู่แล้วเท่านั้น ไม่มีหน้า mock-ERP แยก
- OFFLINE ตรวจจับด้วย watchdog (เช็ค `last_seen_at` ทุก 5 วิ, threshold ปรับได้ผ่าน env) ไม่ใช่ MQTT Last Will เพราะโจทย์คือเครื่อง "หยุดส่งข้อมูล" ไม่ใช่ "ตัดการเชื่อมต่อ"
- Deactivate เครื่องจักรใน Admin = หยุดรับ telemetry จาก MQTT (status → `INACTIVE`) แต่ไม่ได้สั่งเครื่องจริงหยุดทำงาน — คนละเรื่องกับ Emergency Stop ที่ต้องเป็น hardwired safety circuit แยกอิสระ (ดู [Future Vision](#future-vision-สู่-unmanned-lights-out-operation))
- QC Hold Rate ใน Executive KPI **ไม่ได้ทำ** — ไม่มี concept "QC hold" ใน data model ปัจจุบัน ไม่ใส่เลขปลอมมาแสดง
- Performance/OEE ต่อเครื่องจะว่าง (`—`) จนกว่าจะตั้งค่า Target Cycle Time ในหน้า Admin — ไม่ default ค่าเดาเอง

---

## Gap Analysis แบบละเอียด

วิเคราะห์ช่องว่างระหว่างสิ่งที่โจทย์ระบุไว้กับสิ่งที่ต้องพิจารณาเพิ่มเพื่อให้ระบบใช้งานได้จริงในโรงงาน แบ่งเป็น 3 มุมมอง — แต่ละข้อระบุ **ปัญหาที่พบ, แนวทางแก้ไข/สมมติฐานที่ใช้ใน Prototype, และมาตรฐานอ้างอิง** (หากมี)

### 1. การวิเคราะห์เชิงธุรกิจ (Business Analysis)

| # | ปัญหาที่พบ | แนวทางแก้ไข / สมมติฐานใน Prototype | อ้างอิงมาตรฐาน |
|---|---|---|---|
| 1.1 | โจทย์ไม่ได้ระบุว่าปัจจุบันวางแผนการผลิต (Production Scheduling) ด้วยระบบใด ซึ่งกำหนดว่า Job Number ควรถูกสร้างจากภายนอกหรือจากระบบ monitoring เอง | สมมติว่า Job Number สร้างจากระบบภายนอก (ERP) มาก่อน ระบบ monitoring บันทึกผลเทียบกับ Job ที่มีอยู่แล้วเท่านั้น ระบบจริงต้องมี integration layer เชื่อม MES กับ ERP/Planning | ANSI/ISA-95 (IEC 62264) |
| 1.2 | Injection Molding มี Startup Scrap เสมอ (mold ยังไม่ถึง thermal equilibrium) หากไม่แยกจาก reject ปกติ ตัวเลข Yield Rate จะบิดเบือนในงานสั่งผลิตจำนวนน้อย | แยก field `startup_scrap_qty` ออกจาก reject ทั่วไป — shot แรก 3–5 shot หลัง mold change ถือเป็น purge/startup scrap มาตรฐาน | ไม่มีมาตรฐานสากลกำหนดตัวเลข — เป็น business rule ภายในองค์กร |
| 1.3 | ต้องแยกว่า STOP คือหยุดตามแผนหรือ downtime จริง เพราะต้นทุนการ restart ไม่เท่ากัน (barrel เย็นตัวต้อง warm-up ใหม่) | ใช้ threshold เวลาแยก planned pause ออกจาก downtime event ระบบจริงต้องจำแนก Planned/Unplanned/Changeover | ISO 22400-2 |
| 1.4 | สัดส่วนเครื่องที่เชื่อมต่อได้จริงในบรรดา 200 เครื่องไม่ได้ระบุไว้ หากมีเครื่องเก่าจำนวนมาก dashboard จะมี blind spot ถาวร | Prototype จำลองเฉพาะเครื่องที่เชื่อมต่อได้เต็มรูปแบบตามโจทย์ ระบบจริงต้องมี manual data entry fallback สำหรับเครื่องที่เชื่อมต่อไม่ได้ | — |
| 1.5 | การเชื่อมข้อมูลทั้งโรงงานหมายความว่าหากระบบล่ม (เช่นไฟไหม้) การผลิตทั้งหมดเสี่ยง "ตาบอด" | ไม่ implement Disaster Recovery จริงใน Prototype แต่ออกแบบ config ให้รองรับ replication ระบบจริงต้องมี on-site server คู่กับ cloud replica พร้อม DR runbook | ISO 22301 |
| 1.6 | ผู้บริหารต้องการ KPI ที่แปลงจาก raw data แล้ว (Cost per Hour, OEE%, Reject rate, Energy, QC hold rate) ไม่ใช่ Cycle Time ดิบ | เผื่อ field `machine_rated_power_kw`, `labor_cost_per_hour`, `target_cycle_time_sec` ใน config ล่วงหน้า เพื่อคำนวณ KPI ได้โดยไม่ต้องแก้ schema — **implement แล้ว** เป็น Executive KPI view (`/kpi`) แยกจาก Operator dashboard | ISO 22400-2 |
| 1.7 | อุตสาหกรรม Injection Molding มี interface มาตรฐานเชื่อมเครื่องจักรกับ MES อยู่แล้ว การออกแบบ schema เองทั้งหมดทำให้เกิดต้นทุน adapter ซ้ำซ้อนเมื่อซื้อเครื่องรุ่นใหม่ที่รองรับมาตรฐานนี้ | Prototype ออกแบบ JSON payload เอง แต่จัดกลุ่ม field ตามแนวคิด `MachineData`/`JobData`/`ProcessData` เพื่อ map ไปมาตรฐานได้ในอนาคต | EUROMAP 77 (เทียบเท่า OPC 40077), IEC 62541 (OPC UA) |

### 2. การพัฒนาซอฟต์แวร์ (Software Development)

| # | ปัญหาที่พบ | แนวทางแก้ไข / สมมติฐานใน Prototype | อ้างอิงมาตรฐาน |
|---|---|---|---|
| 2.1 | Hardcode รายชื่อเครื่องในโค้ดทำให้การขยายเป็น 200 เครื่องต้อง deploy ใหม่ทุกครั้ง | หน้า Admin เพิ่มเครื่องที่เขียนลง DB ทันทีโดยไม่ต้อง restart service — dynamic MQTT wildcard subscription | — |
| 2.2 | ระบบที่รันคู่กับสายการผลิตจริง deploy พลาดมีต้นทุนสูงกว่าเว็บทั่วไป | ใช้ versioned migration script (up/down) รองรับ rollback ระดับ schema ระบบจริงควรใช้ blue-green deployment หรือ feature flag | — |
| 2.3 | Backup ฐานข้อมูลขนาดใหญ่ระหว่างรับข้อมูล real-time จาก 200 เครื่องพร้อมกัน อาจทำให้ query ช้าลง | ใช้ scheduled `pg_dump` ที่ off-peak hour ใน Prototype ระบบจริงต้องใช้ read replica แยกสำหรับ backup ไม่ให้แย่ง I/O กับ write path หลัก | ISO/IEC 27001 Annex A.12.3 |
| 2.4 | เมื่อเพิ่ม field ใหม่ในอนาคต ต้องไม่ทำให้ consumer เดิมพัง | ออกแบบ payload แบบ additive-only + `schemaVersion` ในทุก payload + API versioning (`/api/v1/`) | — |
| 2.5 | การเปิดใช้ Modbus RTU บน CPU port หนึ่งจะยึด port นั้นทั้งหมด ทำให้ช่างเทคนิคแก้โปรแกรม PLC ผ่านสาย Serial เดิมพร้อมกันไม่ได้ | ระบุ PLC รุ่นที่มีพอร์ตเดียว/สองพอร์ตในเอกสาร วางแผนหน้าต่างเวลาแยกงาน programming ออกจากช่วงเก็บข้อมูล หรือใช้ Ethernet module เสริมแทน | Siemens S7-200 System Manual |
| 2.6 | การอ่านค่าที่เป็น float/double word (เช่น Barrel Temperature) โดยไม่รับประกัน buffer consistency อาจเกิด "torn read" ทำให้ค่าอ่านผิดเพี้ยนแบบสุ่ม | ใช้ Modbus library ที่รับประกัน atomic multi-register read พร้อม sanity check ฝั่ง Backend (ค่ากระโดดเกิน physical limit ให้ flag เป็น suspect) | Modbus Application Protocol Specification |
| 2.7 | Modbus function 03/04/16 อ่าน/เขียนได้สูงสุด 125 holding registers ต่อ 1 request เมื่อเพิ่ม sensor ในอนาคตอาจเกินเพดานนี้ | วางแผน logic แบ่ง (chunking) เป็นหลาย request โดยยังคง cycle time รวมให้อยู่ในเกณฑ์ที่ยอมรับได้ | Modbus Application Protocol Specification |

> **ข้อ 2.5–2.7 เป็น Future Scope** เกี่ยวข้องกับตอนเชื่อมต่อ PLC จริงผ่าน Modbus เท่านั้น ไม่ใช่ส่วนหนึ่งของ Prototype ปัจจุบัน เพราะ Machine Simulator สวมบทบาทแทน PLC ทั้งก้อน จึงข้ามขั้นตอน "PLC poll ค่าจาก sensor ผ่าน Modbus" ไป — สร้างค่า Cycle Time/Pressure/Temperature เองแล้ว publish ผ่าน MQTT โดยตรง ไม่มี Modbus ปรากฏในโค้ด Prototype เลย สามข้อนี้แสดงความเข้าใจ pipeline ทั้งสายสำหรับตอนขยายไปเชื่อมเครื่องจักรจริง

### 3. วิศวกรรมไฟฟ้าและความปลอดภัย (Electrical Engineering & Safety)

| # | ปัญหาที่พบ | แนวทางแก้ไข / สมมติฐานใน Prototype | อ้างอิงมาตรฐาน |
|---|---|---|---|
| 3.1 | Path การ monitoring (PLC → Gateway → MQTT → Dashboard) มีจุดอ่อนที่ยอมรับได้ในงาน monitoring แต่ยอมรับไม่ได้ในงาน safety (network latency, broker ล่ม) | Emergency Shutdown ต้องเป็นวงจร hardwired แยกอิสระ ทำงานแบบ fail-safe ตัดไฟผ่าน safety relay/contactor โดยตรง ระบบ monitoring รับสถานะมา log และแจ้งเตือนเท่านั้น | IEC 60204-1, ISO 13849-1, IEC 62061, EUROMAP 78/78.1 |
| 3.2 | หาก Circuit Breaker ตัดไฟทั้งไลน์ทุกครั้งที่เครื่องเดียวมีปัญหา จะเสียเวลา restart ทุกเครื่องโดยไม่จำเป็น | ทำ selective coordination study (time-current curve) ให้ CB ตัดเฉพาะจุดใกล้ fault ที่สุดก่อน | IEC 60947-2, IEEE 242 |
| 3.3 | สาย Ethernet ทองแดง (Cat5e/Cat6) จำกัดระยะ 100 เมตรต่อ segment โรงงานขนาดใหญ่มักมีระยะเกินนี้ | ใช้ Fiber optic + media converter สำหรับ backbone ระหว่างโซนที่ไกลกัน | IEEE 802.3, TIA/EIA-568 |
| 3.4 | RS-485 (Modbus) แบบไม่มี isolation จำกัดระยะเพียง 50 เมตรต่อ segment | ใช้ RS-485 repeater ขยายได้ถึง 1,000 เมตรต่อ segment เชื่อมต่อกันได้สูงสุด 9 ตัว | TIA/EIA-485-A |
| 3.5 | อุปกรณ์ที่มี reference potential ต่างกันทำให้เกิดกระแสไม่พึงประสงค์ไหลผ่านสายสื่อสาร โดยเฉพาะเครื่องที่ใช้กระแสสูง ทำให้ communication error แบบสุ่ม | ใช้ isolated RS-485 repeater ทุกจุดที่ไม่ได้ใช้ single-point grounding เดียวกัน | IEEE 1100, IEC 61000-5-2 |
| 3.6 | Servo motor/VFD สร้างสัญญาณรบกวนสูง หากเดินสาย signal ขนานกับสายไฟกำลังโดยไม่มี shielding จะเกิด noise | ใช้สาย shielded twisted pair แยก conduit จากสายไฟกำลัง พร้อม single-point grounding | IEC 61000-6-2/6-4 |
| 3.7 | การเพิ่ม I/O module ให้เครื่องเก่าต้องเช็ค power budget (5VDC/24VDC) ของ CPU เดิม | ทำ site survey ก่อน retrofit ทุกเครื่อง คำนวณ power budget ตาม datasheet ก่อนเลือกซื้อ module | Siemens S7-200 System Manual |
| 3.8 | ความสั่นสะเทือนต่อเนื่องจากกลไก clamping/injection ทำให้ terminal แบบ screw หลวมตามเวลา เกิดสัญญาณหลุดเป็นระยะ (false OFFLINE) | ใช้ terminal แบบ spring-loaded ในจุดที่ใกล้แหล่งสั่นสะเทือน | — |
| 3.9 | การซ่อมบำรุงเครื่องเดียวควรทำได้โดยไม่กระทบเครื่องข้างเคียงในไลน์เดียวกัน | ออกแบบ physical isolation (MCCB แบบ withdrawable ที่มีตำแหน่ง ON/OFF/TEST/ISOLATE) ไว้ตั้งแต่ต้น ไม่พึ่ง software toggle อย่างเดียว | IEC 60947-3, ISO 14118 |
| 3.10 | เครือข่ายฝั่ง IT (ERP, Office PC) และ OT (PLC, SCADA) ต้องแยกโซนชัดเจน | วางสถาปัตยกรรมผ่าน Industrial DMZ ตาม Purdue Model | IEC 62443, Purdue Enterprise Reference Architecture |

### 4. กรณีศึกษาอ้างอิง — SCG / Nawaplastic Industries (NPI)

โจทย์อิงบริบทโรงงานผลิตข้อต่อ PVC ด้วย Injection Molding ซึ่งตรงกับ **Nawaplastic Industries Co., Ltd. (NPI)** บริษัทในเครือ SCG Chemicals ก่อตั้งปี 1970 โรงงานหลักที่ Ban Khai จังหวัดระยอง

**ข้อมูลที่ยืนยันได้จากแหล่งสาธารณะ:**

| ประเด็น | ข้อมูลที่พบ | แหล่งอ้างอิง |
|---|---|---|
| Digital platform ที่มีอยู่แล้ว | SCGC มีระบบ "DRS by REPCO NEX" เชื่อมกับ Unified Operations Center (UOC) ที่ระยอง สำหรับบริหารประสิทธิภาพเครื่องจักรและสินทรัพย์ทั้งเครือ | SCGC News, ก.ย. 2025 |
| ระดับ Automation | Nawaplastic มี robot density ระดับ best-in-class ของโลกในสายผลิตท่อ/ข้อต่อ PVC | SCGC News, ก.ค. 2025 |
| สถานะธุรกิจ | อุตสาหกรรมปิโตรเคมีตกต่ำยาวนานกว่าปกติ บริษัทเน้นกลยุทธ์ High Value-Added (HVA) และ green polymer | SCGC News, ก.ค. 2025 |
| วัฒนธรรม Safety/Quality | Prime Minister's Industry Award, Kano Quality Award (Gold), Thailand 5S Award (Diamond), CSR-DIW Continuous Award ต่อเนื่องถึง 2025 | npi-pipe.com/aboutus, SCGC News มี.ค. 2026 |
| โครงสร้างองค์กร | โรงงานในเครือข่ายภูมิภาค: ระยอง, สระบุรี, กัมพูชา, เมียนมา, อินโดนีเซีย, เวียดนาม | nawaplastic.com |

**นัยต่อ Gap Analysis:** ข้อ 1.4 — robot density สูงหมายความว่าจำนวนคนเฝ้าเครื่องต่อไลน์ต่ำกว่าปกติมาก ระบบ monitoring จึงทำหน้าที่แทนสายตาคนได้จริง ข้อ 1.6 — มี UOC/DRS อยู่แล้วในระดับเครือ Prototype ควรออกแบบให้เข้ากันได้เชิงแนวคิดกับแพลตฟอร์มนี้ และภาวะตลาดขาลงทำให้การควบคุมต้นทุนผ่าน digital monitoring สำคัญเชิงกลยุทธ์สูงกว่าปกติ

**ข้อมูลที่ไม่เปิดเผยต่อสาธารณะ** (ตารางเวลาการผลิต, จำนวนพนักงานระดับโรงงาน, ยี่ห้อเครื่องจักร, การแยกสิทธิ์ IT/OT เฉพาะของ NPI) — ใช้กรอบกฎหมาย/มาตรฐานสากลแทนการเดา ระบุไว้ชัดเจนว่าเป็น **Assumption** ไม่ใช่ข้อเท็จจริงที่ยืนยันได้ (เช่น สมมติสายการผลิตเดิน 24/7 อ้างอิง Thailand Labour Protection Act B.E. 2541 มาตรา 23-25 แทนตารางกะจริงที่ไม่เปิดเผย)

### 5. มาตรฐานอ้างอิงทั้งหมด

| หมวด | มาตรฐาน | ครอบคลุมประเด็น |
|---|---|---|
| Manufacturing Integration | ANSI/ISA-95 (IEC 62264) | Enterprise-Control System Integration |
| Manufacturing KPI | ISO 22400-2 | OEE, Availability/Performance/Quality |
| Business Continuity | ISO 22301 | RTO/RPO, Disaster Recovery |
| Information Security | ISO/IEC 27001 | Backup, Access Control |
| Industrial Protocol (Injection Molding) | EUROMAP 77 / OPC 40077 | IMM–MES Data Exchange (OPC UA) |
| Industrial Safety Interface | EUROMAP 78 / 78.1 | Safety Device Acknowledgement |
| Functional Safety | IEC 60204-1, ISO 13849-1, IEC 62061 | Emergency Shutdown, Safety Circuits |
| Machinery Safety | ISO 14118, IEC 60947-3 | Unexpected Start-up Prevention, Isolation |
| Protective Coordination | IEC 60947-2, IEEE 242 | Circuit Breaker Selective Coordination |
| Network Physical Layer | IEEE 802.3, TIA/EIA-568, TIA/EIA-485-A | Ethernet / RS-485 Distance Limits |
| Grounding | IEEE 1100, IEC 61000-5-2 | Ground Potential, Single-Point Earth |
| EMC | IEC 61000-6-2/6-4 | Industrial Noise Immunity/Emission |
| OT Security | IEC 62443 | IT/OT Network Segmentation |
| Fieldbus Protocol | Modbus Application Protocol Spec | Register Limits, Function Codes |
| OPC Framework | IEC 62541 | OPC Unified Architecture |
| Labour Regulation | Thailand Labour Protection Act B.E. 2541 | Working Hours, Continuous Shift Operation |

---

## แนวทางขยายจาก 3 เครื่องไปยัง 200 เครื่อง

| ประเด็น | สถานะตอนนี้ (3 เครื่อง) | ทางขยับไป 200 เครื่อง |
|---|---|---|
| รับข้อมูลเครื่องใหม่ | Admin API/UI + MQTT wildcard subscription — เพิ่มได้ทันทีไม่ redeploy | เหมือนเดิม รองรับอยู่แล้ว ไม่ต้องแก้โค้ด |
| Database เก็บ telemetry | PostgreSQL ตารางเดียว, index บน `(machine_id, timestamp)` | ที่ 200 เครื่อง เก็บทุก 2 วิ ≈ **8.6 ล้านแถว/วัน** — ต้องทำ **table partitioning by time** หรือย้ายไป **TimescaleDB** (extension บน Postgres ตัวเดิม ย้ายได้โดยแทบไม่แก้โค้ด backend) พร้อม retention policy (aggregate ข้อมูลเก่าเป็นค่าเฉลี่ยรายชั่วโมงแล้ว archive) |
| Backup | `pg_dump` ตาม schedule | ต้องใช้ **read replica** แยก I/O สำหรับ backup ไม่ให้แย่งกับ write path หลักที่รับข้อมูลสด |
| เครื่องจักรที่เชื่อมต่อไม่ได้ | สมมติว่าเชื่อมได้ทั้งหมด | โรงงานจริงมีเครื่องเก่าที่เชื่อมไม่ได้ปนอยู่ — ต้องมี manual data entry fallback |
| IT/OT Network | Backend รันในเครือข่ายเดียวกับ dashboard (prototype) | แยกผ่าน **Industrial DMZ** ตาม Purdue Model — OT (PLC/Simulator) ไม่เปิดให้ IT เข้าตรง ต้องผ่านด่านกลางนี้เสมอ (ระบบตอนนี้ถูกออกแบบให้อยู่ตำแหน่งด่านนี้พอดีอยู่แล้ว) |
| สิทธิ์ผู้ใช้งาน | ไม่มี auth เลยใน prototype | ต้องแยก role: Operator เห็นเฉพาะเครื่องที่ดูแล / Line Supervisor เห็นภาพรวมไลน์ / Maintenance เข้า OT zone / Management เข้า Executive dashboard ผ่าน IT zone / System Admin เข้า Industrial DMZ ผ่าน MFA + audit log |
| Field-level protocol | Simulator สวมบทบาทแทน PLC ทั้งก้อน ไม่มี Modbus จริง | เชื่อม PLC จริงผ่าน Modbus RTU/TCP หรือ OPC UA (EUROMAP 77) — มีข้อจำกัดเรื่อง torn read, register limit (125 ต่อ request) ที่ต้องจัดการเพิ่ม (ดู Gap ข้อ 2.5-2.7) |

---

## Future Vision: สู่ Unmanned (Lights-Out) Operation

โรงงาน Injection Molding ที่มี automation/robot density สูงอยู่แล้ว มีศักยภาพจะขยับไปสู่การผลิตแบบ "Unmanned" ได้ในระยะยาว — เอกสารส่วนนี้วางแนวคิดกระบวนการทั้งสาย ตั้งแต่รับ order ลูกค้าจนถึงส่งมอบ logistics พร้อมข้อจำกัดของแต่ละขั้นตอน โดยเฉพาะความปลอดภัยที่เป็นเงื่อนไขจริงของอุตสาหกรรม ไม่ใช่แค่ปัญหาทางเทคนิคของซอฟต์แวร์

**นิยาม "Unmanned" ให้ชัดก่อน**: ไม่ได้หมายถึงไม่มีคนเกี่ยวข้องกับโรงงานเลย แต่คือไม่ต้องมีคนประจำหน้าเครื่องเพื่อควบคุมงานปกติตลอดเวลา บทบาทคนเปลี่ยนจาก "ควบคุมโดยตรง" ไปเป็น "กำกับดูแลโดยข้อยกเว้น" (management by exception) — ความรับผิดชอบด้านความปลอดภัยและเหตุฉุกเฉินยังต้องมีคนอยู่เสมอ เพียงแต่ไม่ต้องอยู่หน้าเครื่องตลอดเวลา

ระบบ Monitoring ในโปรเจกต์นี้อยู่ที่ระดับ Supervisory (Level 2 ตาม ISA-95) วิสัยทัศน์นี้คือขยับขึ้นไปถึง Level 3 (MES) และ Level 4 (ERP/Business) ให้ทำงานแบบ closed-loop กับ Level 0-1 (เครื่องจักร/PLC) โดยอัตโนมัติทั้งสาย

### กระบวนการที่เป็นไอเดีย

1. **Order Intake** — รับ order จาก B2B portal/EDI/ERP แปลงเป็น production requirement ต้องมี business rule ตรวจเครดิต/สัญญาก่อนปล่อยเข้า production และ human approval gate สำหรับ order ผิดปกติ
2. **Feasibility & Capacity Check** — เช็ค mold/recipe รองรับ SKU, คำนวณเวลาจาก cycle time มาตรฐาน — cycle time จริงแปรปรวนตามอุณหภูมิ/การสึกของ mold ต้องให้เป็นช่วงความเชื่อมั่นไม่ใช่ค่าคงที่ และ reserve กำลังผลิตสำรองเผื่อเครื่องเสีย
3. **Virtual Simulation / Mold-Flow Check** — จำลองก่อนสั่งผลิตจริง แต่ไม่แทนการทดสอบจริงได้ 100% ยังต้องมี first-article inspection รอบแรกของแต่ละ job
4. **Autonomous Scheduling & Dispatch** — เลือกเครื่อง จัดคิว dispatch อัตโนมัติ ต้องมีช่องทางให้ operator override คิวได้เสมอ เพราะระบบอาจไม่รู้ปัญหาหน้างานจริงที่ sensor ยังตรวจไม่พบ
5. **Remote Execution** ⚠️ **จุดที่สำคัญที่สุดในทั้งกระบวนการ** — สั่ง start ไปที่ PLC ทางไกล คำสั่งนี้ต้องไม่มีสิทธิ์ bypass การป้องกัน unexpected start-up (ISO 14118) ระบบ remote command เป็นได้แค่ "ผู้ขออนุญาตให้ทำงาน" ไม่ใช่ "ผู้มีอำนาจ override" ความปลอดภัย สายสั่งงานระยะไกล (network/MQTT/API) ต้องแยกทางกายภาพจาก safety circuit เสมอตาม IEC 60204-1 และ EUROMAP 78/78.1 และปุ่ม Emergency Stop ต้องหยุดเครื่องได้แม้ software ทั้งหมดล่ม
6. **Real-time Monitoring & Closed-loop Adjustment** — ปรับพารามิเตอร์เองถ้าพบ trend ผิดปกติ แต่ถ้าไม่มีคน review อาจเกิดของเสียสะสมก่อนรู้ตัว และถ้า sensor fault (เช่น thermocouple หลุด) ระบบอาจ "ปรับ" ตามค่าผิดไปเรื่อยๆ — ต้องมี anomaly detection แยกอิสระจาก control loop หลัก พร้อม hard limit ตัดเข้า safe-stop
7. **Automated QC (Vision Inspection)** — ตรวจ defect ที่มองเห็นได้ดี แต่ตรวจ structural/material property (ความแข็งแรงรับแรงดันของข้อต่อ PVC) ไม่ได้ ยังต้องมี sampling test เชิงกลไกโดยคน/เครื่องมือเฉพาะทางควบคู่เสมอ
8. **Automated Packing & Lot Labeling** — ฉลาก lot ต้อง generate จากข้อมูลที่ verified แล้วเท่านั้น (หลัง QC pass) ไม่ใช่ตามแผนเดิม เพราะถ้ามีการสลับ mold/recipe กลางคันโดยไม่ตั้งใจ ฉลากต้องสะท้อนสิ่งที่เกิดขึ้นจริง
9. **Handoff to Logistics** — ต้องมี reconciliation step เทียบจำนวนที่ระบบคาดว่าผลิตได้กับจำนวนจริงที่ scan เข้าคลังเสมอ ห้ามเชื่อตัวเลขจาก production system ไปตรงๆ

### ข้อจำกัดข้ามกระบวนการ (Cross-cutting Limitations)

- **Functional Safety** — Emergency Stop และ safety interlock ต้องเป็นวงจร hardwired แยกอิสระจาก network/software path เสมอ (IEC 60204-1, ISO 13849-1, IEC 62061) ระบบอัตโนมัติ/remote เป็นได้แค่ผู้ขออนุญาต การป้องกัน unexpected start-up (ISO 14118) ต้องทำงานได้แม้ไม่มีคนอยู่หน้าเครื่องเลย เพราะนั่นคือสถานการณ์ปกติของ unmanned ไม่ใช่กรณีพิเศษ
- **ความปลอดภัยไซเบอร์ฝั่ง OT** — remote command channel ที่สั่งเครื่องจักรทำงานได้จริงจากนอกไซต์ เป็น attack surface ร้ายแรงกว่า monitoring ทั่วไปมาก (ผลลัพธ์ไม่ใช่แค่ข้อมูลรั่ว แต่เครื่องจักรทำงานผิดจากที่ตั้งใจได้) ต้องมี mutual authentication, command signing, แยกโซนตาม IEC 62443 เข้มงวดกว่ามาตรฐาน
- **การกำกับดูแลทางกฎหมาย** — หลายประเทศกำหนดให้เครื่องจักรบางประเภทต้องมีผู้ควบคุมที่ผ่านการรับรองอยู่ในพื้นที่ปฏิบัติงาน การทำ unmanned เต็มรูปแบบต้องตรวจข้อกฎหมายท้องถิ่นเป็นรายกรณี รวมคำถามเรื่องผู้รับผิดชอบทางกฎหมายหากเกิดอุบัติเหตุ
- **เหตุฉุกเฉินที่ไม่ใช่ไฟฟ้า/ซอฟต์แวร์** — เพลิงไหม้ สารเคมีรั่ว เครื่องติดขัดทางกล ต้องมีแผนตอบสนองที่ไม่พึ่งพาคนในพื้นที่ (ระบบดับเพลิงอัตโนมัติ, ทีม maintenance standby นอกไซต์)
- **ความน่าเชื่อถือของโครงสร้างพื้นฐาน** — เมื่อไม่มีคนสังเกต/intervene ได้ ทุก single point of failure (network/ไฟฟ้า/broker) กลายเป็น "ไม่มีใครหยุดเครื่องได้เลยถ้าจำเป็น" ต้องมี redundancy ในทุกชั้นที่เกี่ยวข้องกับ safety-relevant path
- **คุณภาพและความรับผิดชอบต่อผลิตภัณฑ์** — ข้อต่อ PVC เกี่ยวข้องกับระบบท่อรับแรงดัน การให้ QC เป็น vision system ทั้งหมดโดยไม่มี sampling test เชิงกลไกเป็นความเสี่ยงที่ยอมรับไม่ได้สำหรับสินค้าประเภทนี้

**สรุป**: Unmanned ไม่ได้แปลว่าตัดคนออกจากระบบทั้งหมด แต่คือเปลี่ยนบทบาทคนจากการควบคุมโดยตรงตลอดเวลา ไปเป็นการกำกับดูแลโดยข้อยกเว้น ความปลอดภัยทางกายภาพต้องยังคงเป็นชั้นที่แยกอิสระจากระบบอัตโนมัติเสมอ ไม่ว่าซอฟต์แวร์จะฉลาดแค่ไหนก็ตาม

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
- [`BACKGROUND.md`](BACKGROUND.md) — พื้นฐาน Automation Pyramid, IT/OT Convergence (อ่านก่อนถ้าไม่คุ้นเคยกับศัพท์เทคนิค)
