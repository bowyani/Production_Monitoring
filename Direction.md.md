# INTERVIEW ASSIGNMENT

## Digital Manufacturing & Infrastructure

โจทย์นี้ใช้ประเมินความสามารถในการพัฒนา Software สำหรับงาน Digital Manufacturing โดยเน้นการเขียนโปรแกรม การออกแบบระบบ Database, API และการนำข้อมูลไปใช้กับกระบวนการผลิตจริง

---

## 1. ข้อมูลเบื้องต้น

บริษัทเป็นโรงงานผลิตข้อต่อ PVC ด้วย Injection Molding มีการผลิตสินค้าหลากหลายและมีเครื่องจักรจำนวนมาก ปัจจุบันข้อมูลจากกระบวนการผลิตและเครื่องจักรยังไม่ได้เชื่อมโยงเป็นระบบเดียวกัน และยังมีการทำงานแบบ Manual อยู่หลายส่วน

### ขนาดของโรงงาน

- Injection Molding Machine ประมาณ **200 เครื่อง**
- สินค้า **2,000+ SKU**
- Mold และ Recipe จำนวนมาก
- พนักงานประมาณ **500 คน**
- มีทั้งตลาดในประเทศและต่างประเทศ

### สภาพระบบปัจจุบัน

- เครื่องจักรหลายยี่ห้อและหลาย Generation
- มีทั้งเครื่องที่เชื่อมต่อข้อมูลได้และเครื่องเก่า
- ข้อมูลบางส่วนยังเป็นกระดาษหรือ Excel
- มีระบบ IT ภายในองค์กรอยู่แล้ว
- ต้องคำนึงถึงการใช้งานจริงในโรงงานและความปลอดภัย

---

## 2. โจทย์

ให้พัฒนา **Prototype ระบบ Production Monitoring** สำหรับเครื่อง Injection Molding จำนวนอย่างน้อย 3 เครื่อง โดยระบบต้องสามารถ:

1. รับข้อมูลจาก Machine Simulator
2. จัดเก็บข้อมูลลง Database
3. แสดงสถานะและข้อมูลการผลิตบน Dashboard
4. ดูข้อมูลย้อนหลังได้
5. ค้นหาข้อมูลการผลิตจาก Job Number ได้
6. แสดง Alarm และสถานะการเชื่อมต่อของเครื่องจักร

> **หมายเหตุ:** ผู้สมัครสามารถตั้งสมมติฐานเพิ่มเติมได้ โดยระบุไว้ใน README

---

## 3. ข้อมูลขั้นต่ำของระบบที่ต้องการ

| หมวดหมู่            | รายการข้อมูล (Fields)                                                                                                                                                 |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine Data**    | • Machine ID<br>• Timestamp<br>• Machine Status: `RUN` / `STOP` / `ALARM` / `OFFLINE`<br>• Cycle Time<br>• Shot Count<br>• Injection Pressure<br>• Barrel Temperature |
| **Production Data** | • Job Number<br>• Product Code<br>• Mold ID<br>• Recipe ID<br>• Good Quantity<br>• Reject Quantity                                                                    |
| **Alarm Data**      | • Alarm Code<br>• Alarm Message<br>• Alarm Timestamp                                                                                                                  |

---

## 4. Function ที่ต้องมี

### 1) Machine Simulator

จำลองเครื่องจักรอย่างน้อย 3 เครื่อง โดยสามารถ:

- ส่งข้อมูลตามช่วงเวลาที่กำหนด
- เปลี่ยนสถานะระหว่าง `RUN`, `STOP` และ `ALARM`
- จำลองค่าการผลิต เช่น Cycle Time, Pressure และ Temperature
- หยุดส่งข้อมูลเพื่อจำลองสถานะ `OFFLINE`
- _เลือกส่งข้อมูลผ่าน MQTT, REST API หรือวิธีอื่นที่เหมาะสม_

### 2) Backend และ Database

ระบบต้องสามารถ:

- รับข้อมูลจาก Machine Simulator
- ตรวจสอบและบันทึกข้อมูลลง Database
- ให้บริการ API สำหรับ Dashboard
- จัดเก็บ Machine Data, Production Job และ Alarm
- มี Log สำหรับตรวจสอบการทำงานเบื้องต้น

### 3) Production Dashboard

Dashboard ต้องแสดงอย่างน้อย:

- สถานะล่าสุดของแต่ละเครื่อง
- Job Number และ Product Code
- Cycle Time
- Good และ Reject Quantity
- Active Alarm
- เวลาที่ได้รับข้อมูลล่าสุด

### 4) Historical Data

ผู้ใช้งานต้องสามารถ:

- เลือกเครื่องจักร
- เลือกช่วงเวลา
- ดูข้อมูล Cycle Time หรือ Process Parameter ย้อนหลัง
- ดูประวัติ Alarm

### 5) Production Search

ผู้ใช้งานต้องสามารถค้นหาด้วย Job Number และดูข้อมูลที่เกี่ยวข้อง เช่น:

- Machine
- Product
- Mold
- Recipe
- Production Quantity
- Alarm ที่เกิดขึ้นระหว่างการผลิต

---

## 5. Infrastructure & Security (อธิบายเชิงแนวคิด)

ให้อธิบายเป็นภาพรวมสั้น ๆ ว่า หากนำ Prototype ไปใช้งานจริงจะ:

- เชื่อมต่อเครื่องจักรอย่างไร
- แยก IT และ OT Network อย่างไร
- ควบคุมสิทธิ์ผู้ใช้งานอย่างไร
- Backup ข้อมูลอย่างไร
- ขยายจาก 3 เครื่องไปยัง 200 เครื่องอย่างไร

_ส่วนนี้ไม่จำเป็นต้อง Implement จริงใน Prototype หากมีประสบการณ์ด้าน OPC, MQTT, Industrial Network หรือ OT Security สามารถนำเสนอเพิ่มเติมได้ และจะพิจารณาเป็นพิเศษ_

---

## 6. สิ่งที่ต้องส่ง

| รายการ                      | รายละเอียด                                                                                                                                           |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Architecture Diagram** | จำนวน 1 ภาพ แสดง Machine Simulator, Data Connection, Backend, Database และ Dashboard                                                                 |
| **2. Working Prototype**    | ระบบต้องสามารถติดตั้งและ Run ได้จริง                                                                                                                 |
| **3. Source Code**          | ส่งผ่าน Git Repository                                                                                                                               |
| **4. README**               | Technology ที่เลือกใช้และเหตุผล, วิธีติดตั้งและ Run, Database Structure, API หรือ Message Format, สมมติฐานและข้อจำกัด และแนวทางขยายไปยัง 200 เครื่อง |
| **5. Presentation**         | ไม่เกิน 10 หน้า                                                                                                                                      |

---

## 7. Live Demo

ระหว่างการนำเสนอ ผู้สมัครต้องสาธิต:

1. Machine Simulator ส่งข้อมูล
2. Dashboard แสดงสถานะเครื่องจักร
3. เครื่องจักรเปลี่ยนเป็น `ALARM`
4. เครื่องจักรหยุดส่งข้อมูลและแสดงเป็น `OFFLINE`
5. Historical Data
6. ค้นหาข้อมูลด้วย Job Number

> **หมายเหตุ:** กรรมการอาจให้เปลี่ยน Parameter, เพิ่มเครื่องจักร หรือแก้ไข Configuration เล็กน้อย เพื่อประเมินความเข้าใจและวิธีการแก้ปัญหา

---

## 8. ระยะเวลาทำโจทย์ & รูปแบบการพัฒนา

- **ระยะเวลา:** ส่งงานภายใน **7 วัน** นับจากวันที่ได้รับโจทย์ (เน้นระบบที่ Run ได้จริงและอธิบาย Code ได้)
- **Tech Stack:** ไม่จำกัด Programming Language, Framework หรือ Database (เลือกใช้ตามความถนัด)
  - _ตัวอย่าง:_ TypeScript/JavaScript, C#/.NET, Python, Java, React/Next.js, Node.js, PostgreSQL, SQL Server, Docker, Git
- **จุดเน้น:** Programming, Code Quality, Database Design, API, Debugging และการใช้งานจริง มากกว่าความสวยงามของหน้าจอ
- **การใช้ AI:** อนุญาตให้ใช้ AI ได้ แต่ต้องเข้าใจงานทั้งหมดและสามารถอธิบาย/แก้ไข Code ต่อหน้ากรรมการได้

---

## 9. เกณฑ์ประเมิน

| หัวข้อ                                     | น้ำหนัก |
| :----------------------------------------- | :-----: |
| Programming & Code Quality                 | **25%** |
| Working Prototype & Functionality          | **20%** |
| Database & Data Model                      | **15%** |
| Backend / API / Integration                | **15%** |
| Software Architecture                      | **10%** |
| Troubleshooting & Debugging                | **10%** |
| Manufacturing Understanding & Presentation | **5%**  |

### พิจารณาเป็นพิเศษ

หากผู้สมัครมีความสามารถเพิ่มเติมด้าน Machine Connectivity, OPC UA/OPC DA, MQTT, Modbus, Industrial Network หรือ OT Cybersecurity

---

## 10. เป้าหมายของงาน

ต้องการเห็นว่าผู้สมัครสามารถรับ Requirement แล้วพัฒนาออกมาเป็น Software ที่ Run ได้จริง มีโครงสร้าง Code และ Database ที่เหมาะสม เชื่อมต่อข้อมูลได้ และสามารถแก้ไขหรือ Debug ระบบของตัวเองได้
