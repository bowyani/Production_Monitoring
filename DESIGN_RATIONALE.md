# Design Rationale — สถาปัตยกรรม, Schema และเหตุผลการเลือกออกแบบ

เอกสารนี้ใช้อ้างอิงคู่กับ `GAP_ANALYSIS.md` เก็บรายละเอียดว่า Prototype นี้ออกแบบสถาปัตยกรรม/ฐานข้อมูล/message format อย่างไร และเลือกแนวทางนั้นด้วยเหตุผลอะไร เทียบกับทางเลือกอื่นที่พิจารณาแล้วไม่เลือก เพื่อให้อธิบายต่อหน้ากรรมการได้ว่าทำไมถึงออกแบบแบบนี้ ไม่ใช่แค่ "ทำได้"

---

## 1. ภาพรวมสถาปัตยกรรม

Machine Simulator (Node.js + mqtt.js, รันหลาย instance อย่างน้อย 3 เครื่อง) publish ข้อมูลไปที่ MQTT Broker (Mosquitto, รันผ่าน Docker) → Backend (Node.js/TypeScript) subscribe ข้อมูลแบบ wildcard topic → validate แล้วเขียนลง PostgreSQL → เปิด REST API (versioned) และ WebSocket ให้ React Dashboard ทั้งฝั่ง Operator (ดูสถานะ/historical/ค้นหา) และฝั่ง Admin (จัดการรายชื่อเครื่องจักร)

การเพิ่มเครื่องจักรใหม่ (เช่นตอน Live Demo ที่กรรมการอาจขอให้เพิ่มเครื่องจักรกลางคัน ตามที่ระบุไว้ในข้อ 7 ของ Direction.md) ทำได้จากหน้า Admin โดยไม่ต้อง restart service ใด ๆ เพราะ Backend subscribe MQTT ด้วย wildcard (`factory/+/telemetry` เป็นต้น) ไว้ตั้งแต่แรก และ topic ใหม่จะถูกรับข้อมูลได้ทันทีที่เครื่องนั้นถูกลงทะเบียนใน DB

## 2. Database Schema (PostgreSQL)

**machines** — machine_id (PK), machine_name, status (cache สถานะล่าสุด), last_seen_at, is_active, created_at, created_by
เพิ่มจากดราฟต์เดิม: เครื่องจักรถูกเพิ่มผ่าน Admin API แล้ว insert ตรงนี้ทันที ไม่ hardcode ในโค้ด (ตอบ GAP ข้อ 2.1)

**machine_telemetry** — id, machine_id (FK), timestamp, status, cycle_time_sec, shot_count, injection_pressure_bar, barrel_temperature_c

**machine_status_events** — id, machine_id (FK), from_status, to_status, changed_at (ใช้ log ตอน watchdog เจอ OFFLINE ด้วย)

**production_jobs** — job_number (PK), machine_id (FK), product_code, mold_id, recipe_id, start_time, end_time, good_qty, reject_qty, startup_scrap_qty, status

**alarms** — id, machine_id (FK), job_number (FK nullable), alarm_code, alarm_message, alarm_timestamp, cleared_timestamp

**Schema versioning / migration**: ใช้ migration tool ที่ generate ไฟล์ migration แบบมีเลขลำดับ พร้อม track ประวัติอัตโนมัติ (เช่น Prisma Migrate) แทนการรัน SQL ALTER สด ๆ ทุกไฟล์ migration commit เข้า repo เพื่อให้ rollback หรือย้อนดูประวัติการเปลี่ยน schema ได้ (ตอบ GAP ข้อ 2.2)

## 3. MQTT Topic & Payload

Topic: `factory/{machineId}/telemetry`, `factory/{machineId}/job`, `factory/{machineId}/alarm`
Backend subscribe ด้วย wildcard `factory/+/...` ครั้งเดียวตอน start ไม่ต้องแก้โค้ดเมื่อมีเครื่องใหม่

ทุก payload เพิ่ม field `schemaVersion` (เช่น `"1.0"`) เข้าไป และออกแบบแบบ additive-only (field ใหม่ในอนาคตต้องเป็น optional ห้ามลบ/เปลี่ยนชื่อ field เดิม) เพื่อไม่ให้ consumer เก่าพังเมื่อมีการเพิ่ม field ใหม่ในอนาคต เช่น multi-zone temperature (ตอบ GAP ข้อ 2.4)

ตัวอย่าง telemetry payload:

```json
{
  "schemaVersion": "1.0",
  "machineId": "IMM-01",
  "timestamp": "2026-08-20T10:00:00Z",
  "machineData": { "status": "RUN" },
  "processData": {
    "cycleTimeSec": 12.4,
    "shotCount": 1345,
    "injectionPressureBar": 850,
    "barrelTemperatureC": 220.5
  }
}
```

ข้อความที่มาจาก machineId ที่ยังไม่ถูกลงทะเบียนในตาราง machines จะถูก reject พร้อม log แจ้งเตือน (ไม่ auto-register) เพื่อกันข้อมูลขยะปนเข้า DB — ต้องลงทะเบียนผ่าน Admin ก่อนเสมอ

## 4. REST API (versioned)

Prefix ทุก endpoint ด้วย `/api/v1/` เพื่อให้เพิ่ม `/api/v2/` ในอนาคตได้โดยไม่กระทบ consumer เดิม (ตอบ GAP ข้อ 2.4)

Operator/Dashboard:

- `GET /api/v1/machines` — สถานะล่าสุดทุกเครื่อง
- `GET /api/v1/machines/:id/history?from=&to=` — ข้อมูลย้อนหลัง
- `GET /api/v1/machines/:id/alarms?from=&to=` — ประวัติ alarm ของเครื่อง
- `GET /api/v1/jobs/:jobNumber` — ค้นหาด้วย Job Number
- `GET /api/v1/alarms/active` — alarm ที่ active อยู่ทั้งโรงงาน
- WebSocket `/live` — push real-time update

Admin (ใหม่ ตอบ GAP ข้อ 2.1):

- `POST /api/v1/admin/machines` — ลงทะเบียนเครื่องจักรใหม่ (มีผลทันที ไม่ต้อง restart)
- `GET /api/v1/admin/machines` — รายชื่อเครื่องทั้งหมดสำหรับหน้าจัดการ
- `PATCH /api/v1/admin/machines/:id` — แก้ไขชื่อ/สถานะ active ของเครื่อง

## 5. Design Rationale — ทำไมเลือกทางนี้ เทียบกับทางเลือกอื่น

**MQTT (pub/sub) แทน REST polling** — เป็น event-driven ไม่ต้องยิง request รัวๆ, latency ต่ำกว่า, จำลอง OFFLINE ได้เนียนกว่าด้วยการหยุด publish ตรงๆ, เป็น pattern มาตรฐานของ IIoT ที่ตรงกับหัวข้อ "พิจารณาเป็นพิเศษ" ในเกณฑ์ประเมิน ข้อเสียคือต้องดูแล broker เพิ่มหนึ่งตัว และ debug ยากกว่า REST ตรงที่ทดสอบด้วย curl ตรงๆ ไม่ได้ ต้องมี MQTT client ช่วย

**PostgreSQL เดียวเก็บทั้ง telemetry และข้อมูลเชิงสัมพันธ์ แทน time-series DB เฉพาะทาง (Influx/Timescale)** — ที่ระดับ 3-10 เครื่อง ข้อมูลยังน้อย การมี DB เดียวดูแลง่ายกว่าและ join กับ job/alarm ได้สะดวก ข้อเสียคือถ้าขยายไป 200 เครื่องจริงและเก็บทุก 2 วิ ตาราง telemetry จะโตเร็ว ต้องทำ partitioning หรือย้ายไปใช้ TimescaleDB (เป็น extension บน Postgres จึงย้ายทีหลังได้โดยแทบไม่แก้โค้ด backend) — ระบุเป็นแนวทางขยายระบบใน README

**Schema แบบ normalize 5 ตาราง แทนตารางเดียวแบบ denormalize** — สะท้อนความเข้าใจ relational design ตรงกับเกณฑ์ Database & Data Model (15%) ข้อเสียคือ query ต้อง join หลายตารางขึ้นเล็กน้อย แลกกับความถูกต้องของข้อมูลและขยาย field ได้ง่ายกว่าในระยะยาว

**WebSocket push แทน Dashboard polling REST เอง** — ให้ประสบการณ์ real-time จริงตอน demo สด (เครื่องเปลี่ยน ALARM ปุ๊บ จอเปลี่ยนปั๊บ) ข้อเสียคือเพิ่มความซับซ้อนเรื่อง connection/reconnect management เทียบกับ REST polling ที่ง่ายกว่าแต่มี delay

**Backend watchdog (เช็ค last_seen_at) แทน MQTT Last Will Testament (LWT) สำหรับตรวจ OFFLINE** — โจทย์ระบุว่า simulator "หยุดส่งข้อมูล" ไม่ใช่ "ตัดการเชื่อมต่อ" ถ้าใช้ LWT อย่างเดียวจะจับ OFFLINE ไม่ได้ในกรณีนี้ watchdog จับได้ทุกกรณีแต่แลกกับความหน่วง (รอครบ threshold เช่น 15 วิ)

**Simulator ทำหน้าที่แทน ERP เปิด Job เอง แทนการสร้างหน้า mock-ERP แยก** — ตรงกับสมมติฐานใน GAP_ANALYSIS ว่า Job Number มาจากภายนอกอยู่แล้ว และลดความซับซ้อนของ prototype ให้โฟกัสที่ Monitoring เป็นหลัก ข้อเสียคือแยกขอบเขต MES/ERP ไม่ชัดเท่าของจริง ระบุเป็น assumption ชัดเจนใน README

**Admin page + dynamic MQTT wildcard subscription แทนการ hardcode รายชื่อเครื่องแล้ว deploy ใหม่** — เลือกทำเพราะ Direction.md ข้อ 7 ระบุตรงๆ ว่ากรรมการอาจขอให้ "เพิ่มเครื่องจักร" กลางการ demo สด ถ้าไม่มีความสามารถนี้จะทำ requirement ข้อนี้ไม่ผ่านทันที ไม่ใช่แค่ nice-to-have ตามที่ GAP ข้อ 2.1 วิเคราะห์ไว้ ข้อเสียเดียวคือใช้เวลาพัฒนาเพิ่มขึ้นเล็กน้อยเพราะต้องทำทั้ง Admin UI และ backend ฝั่ง dynamic subscribe

**Migration tool แบบ versioned (up/down) แทนการรัน SQL ALTER สดตอน deploy** — ระบบที่รันคู่กับสายการผลิตจริง deploy พลาดมีต้นทุนสูง (ตามที่ GAP ข้อ 2.2 วิเคราะห์) การมี rollback path ที่ทดสอบแล้วจึงจำเป็นกว่าเว็บทั่วไป ข้อเสียคือต้องเรียนรู้ syntax ของ migration tool เพิ่มจากการเขียน SQL ตรงๆ

**schemaVersion ใน payload + API versioning (`/api/v1/`) แทนการไม่ทำ versioning เลย** — โรงงานมีเครื่องจักรหลาย Generation ใช้งานพร้อมกันเป็นปกติ (ตามที่ระบุในข้อ 1 ของ Direction.md) การันตีว่า consumer เดิมที่อ่าน payload v1 จะไม่พังเมื่อเพิ่ม field ใหม่ในอนาคตจึงสำคัญกว่าความเรียบง่ายตอนนี้

## 6. ตาราง Crosswalk กับ GAP_ANALYSIS.md

| ข้อใน GAP_ANALYSIS | ประเด็น                              | วิธีที่ Design นี้ตอบ                                      |
| ------------------ | ------------------------------------ | ---------------------------------------------------------- |
| 1.2                | Startup scrap ปนกับ reject           | field `startup_scrap_qty` แยกใน production_jobs            |
| 1.7                | เผื่อ map เข้ามาตรฐาน EUROMAP 77     | payload จัดกลุ่ม machineData/jobData/processData/alarmData |
| 2.1                | Hardcode รายชื่อเครื่อง              | Admin API/GUI + MQTT wildcard subscription                 |
| 2.2                | Deploy พลาดต้นทุนสูง                 | Migration tool แบบ versioned up/down                       |
| 2.4                | Field ใหม่ต้องไม่ทำ consumer เดิมพัง | `schemaVersion` ใน payload + `/api/v1/` ใน REST API        |

_หมายเหตุ: ข้อ 2.5–2.7 (Modbus RTU/torn read/register limit) เป็น Future Scope ตามที่ GAP_ANALYSIS ระบุไว้แล้วว่าไม่เกี่ยวกับ Prototype นี้ เพราะ Machine Simulator สวมบทบาทแทน PLC ทั้งก้อน จึงไม่ระบุซ้ำในเอกสารนี้_
