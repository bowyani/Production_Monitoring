# Production Monitoring

อ่านไฟล์ `BACKGROUND.md` ก่อน เพื่อเข้าใจบริบทโรงงานและสถาปัตยกรรมภาพรวม

## Quick Start

ต้องมี [Docker Desktop](https://www.docker.com/products/docker-desktop/) เท่านั้น

```bash
cp .env.example .env
docker compose up -d
```

คำสั่งเดียวจะสร้างและรันครบทั้งระบบ: Mosquitto, PostgreSQL (migrate schema อัตโนมัติ), Backend, Dashboard, และ Machine Simulator 3 เครื่อง (`IMM-01`, `IMM-02`, `IMM-03`) ที่ลงทะเบียนตัวเองและเริ่ม publish ข้อมูลทันที ไม่ต้องตั้งค่าอะไรเพิ่ม

- Dashboard (Operator + Admin): http://localhost:5173
- Backend REST API: http://localhost:3000/api/v1
- Backend health check: http://localhost:3000/health

ดูสถานะ container ทั้งหมด:

```bash
docker compose ps
```

หยุดระบบ (เก็บข้อมูลไว้):

```bash
docker compose down
```

หยุดและล้างข้อมูลทั้งหมด (เริ่มใหม่จากศูนย์):

```bash
docker compose down -v
```

## โครงสร้าง Repo

```
simulator/    Machine Simulator (Node.js + mqtt.js) — จำลองเครื่องฉีดพลาสติกหลาย instance
backend/      Node.js/TypeScript — MQTT subscriber + REST API v1 + WebSocket + Prisma/PostgreSQL
dashboard/    React + Vite — Operator view และ Admin view
mosquitto/    ค่าตั้งค่า MQTT broker
```

## เอกสารออกแบบ

- `BACKGROUND.md` — พื้นฐานที่ควรอ่านก่อน (Automation Pyramid, IT/OT Convergence)
- `GAP_ANALYSIS.md` — วิเคราะห์ช่องว่างของโจทย์ ทั้งมุมธุรกิจ/ซอฟต์แวร์/วิศวกรรมไฟฟ้า
- `DESIGN_RATIONALE.md` — สถาปัตยกรรม, Database Schema, MQTT/REST payload พร้อมเหตุผลการออกแบบ
- `FUTURE_VISION_UNMANNED_OPERATION.md` — วิสัยทัศน์ระยะยาวสู่ Unmanned Operation

## Assumptions สำคัญ (รายละเอียดใน GAP_ANALYSIS.md)

- เครื่องจักรต้องลงทะเบียนผ่าน Admin API ก่อนเสมอ ระบบจะไม่ auto-register จาก MQTT — Simulator เรียก Admin API เพื่อลงทะเบียนตัวเองตอนเริ่มทำงาน จำลองขั้นตอน commissioning ของช่างเทคนิคจริง
- Job Number มาจากระบบภายนอก (สมมติว่าเป็น ERP) — ระบบ Monitoring บันทึกผลเทียบกับ Job ที่มีอยู่แล้วเท่านั้น
- OFFLINE ตรวจจับด้วย watchdog (เช็ค `last_seen_at`) ไม่ใช่ MQTT Last Will เพราะโจทย์คือเครื่อง "หยุดส่งข้อมูล" ไม่ใช่ "ตัดการเชื่อมต่อ"
