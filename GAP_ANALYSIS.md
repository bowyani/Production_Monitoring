# Gap Analysis & Assumptions — ช่องว่างของ Requirement ที่นอกเหนือจากโจทย์

เอกสารนี้วิเคราะห์ช่องว่างระหว่างสิ่งที่โจทย์ระบุไว้กับสิ่งที่ต้องพิจารณาเพิ่มเพื่อให้ระบบใช้งานได้จริงในโรงงาน แบ่งเป็น 3 มุมมอง: **การวิเคราะห์เชิงธุรกิจ, การพัฒนาซอฟต์แวร์, วิศวกรรมไฟฟ้าและความปลอดภัย** แต่ละหัวข้อระบุ **ปัญหาที่พบ, แนวทางแก้ไข/สมมติฐานที่ใช้ใน Prototype, และมาตรฐานอ้างอิง** (หากมี)

---

## 1. การวิเคราะห์เชิงธุรกิจ (Business Analysis)

| #   | ปัญหาที่พบ                                                                                                                                                                               | แนวทางแก้ไข / สมมติฐานใน Prototype                                                                                                                                                        | อ้างอิงมาตรฐาน                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1.1 | โจทย์ไม่ได้ระบุว่าปัจจุบันวางแผนการผลิต (Production Scheduling) ด้วยระบบใด ซึ่งกำหนดว่า Job Number ควรถูกสร้างจากภายนอกหรือจากระบบ monitoring เอง                                        | สมมติว่า Job Number สร้างจากระบบภายนอก (ERP) มาก่อน ระบบ monitoring บันทึกผลเทียบกับ Job ที่มีอยู่แล้วเท่านั้น ระบบจริงต้องมี integration layer เชื่อม MES กับ ERP/Planning               | ANSI/ISA-95 (IEC 62264) — Enterprise-Control System Integration                |
| 1.2 | Injection Molding มี Startup Scrap เสมอ (mold ยังไม่ถึง thermal equilibrium) หากไม่แยกจาก reject ปกติ ตัวเลข Yield Rate จะบิดเบือนในงานสั่งผลิตจำนวนน้อย                                 | แยก field `is_startup_scrap` ออกจาก reject ทั่วไป อ้างอิง practice ทั่วไปของอุตสาหกรรมว่า shot แรก 3–5 shot หลัง mold change ถือเป็น purge/startup scrap มาตรฐาน                          | ไม่มีมาตรฐานสากลกำหนดตัวเลข — เป็น business rule ภายในองค์กร                   |
| 1.3 | ต้องแยกว่า STOP คือหยุดตามแผนหรือ downtime จริง เพราะต้นทุนการ restart ไม่เท่ากัน (barrel เย็นตัวต้อง warm-up ใหม่)                                                                      | ใช้ threshold เวลาแยก planned pause ออกจาก downtime event ระบบจริงต้องจำแนก Planned/Unplanned/Changeover                                                                                  | ISO 22400-2 — นิยาม Availability/Performance/Quality สำหรับ OEE                |
| 1.4 | สัดส่วนเครื่องที่เชื่อมต่อได้จริงในบรรดา 200 เครื่องไม่ได้ระบุไว้ หากมีเครื่องเก่าจำนวนมาก dashboard จะมี blind spot ถาวร                                                                | Prototype จำลองเฉพาะเครื่องที่เชื่อมต่อได้เต็มรูปแบบตามโจทย์ ระบบจริงต้องมี manual data entry fallback สำหรับเครื่องที่เชื่อมต่อไม่ได้                                                    | —                                                                              |
| 1.5 | การเชื่อมข้อมูลทั้งโรงงานหมายความว่าหากระบบล่ม (เช่น กรณีไฟไหม้) การผลิตทั้งหมดเสี่ยง "ตาบอด"                                                                                            | ไม่ implement Disaster Recovery จริงใน Prototype แต่ออกแบบ config ให้รองรับ replication ระบบจริงต้องมี on-site server คู่กับ cloud replica พร้อม DR runbook                               | ISO 22301 — Business Continuity Management Systems                             |
| 1.6 | ผู้บริหารต้องการ KPI ที่แปลงจาก raw data แล้ว (Cost per Hour, OEE%, Reject rate, Energy, QC hold rate) ไม่ใช่ Cycle Time ดิบ                                                             | เผื่อ field `machine_rated_power_kw` และ `labor_cost_per_hour` ใน config ล่วงหน้า เพื่อคำนวณ KPI ได้โดยไม่ต้องแก้ schema ระบบจริงต้องมี Executive dashboard แยกชั้นจาก Operator dashboard | ISO 22400-2                                                                    |
| 1.7 | อุตสาหกรรม Injection Molding มี interface มาตรฐานเชื่อมเครื่องจักรกับ MES อยู่แล้ว การออกแบบ schema เองทั้งหมดทำให้เกิดต้นทุน adapter ซ้ำซ้อนเมื่อซื้อเครื่องรุ่นใหม่ที่รองรับมาตรฐานนี้ | Prototype ออกแบบ JSON payload เอง แต่จัดกลุ่ม field ตามแนวคิด `MachineData` / `JobData` / `ProcessData` เพื่อ map ไปมาตรฐานได้ในอนาคต                                                     | EUROMAP 77 (เทียบเท่า OPC 40077), อ้างอิง IEC 62541 (OPC Unified Architecture) |

---

## 2. การพัฒนาซอฟต์แวร์ (Software Development)

| #   | ปัญหาที่พบ                                                                                                                                        | แนวทางแก้ไข / สมมติฐานใน Prototype                                                                                                                                               | อ้างอิงมาตรฐาน                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2.1 | Hardcode รายชื่อเครื่องในโค้ดทำให้การขยายเป็น 200 เครื่องต้อง deploy ใหม่ทุกครั้ง                                                                 | หน้า Admin เพิ่มเครื่องที่เขียนลง DB ทันทีโดยไม่ต้อง restart service ระบบจริงต้องรองรับ dynamic MQTT topic subscription                                                          | —                                                                     |
| 2.2 | ระบบที่รันคู่กับสายการผลิตจริง deploy พลาดมีต้นทุนสูงกว่าเว็บทั่วไป                                                                               | ใช้ versioned migration script (up/down) รองรับ rollback ระดับ schema ระบบจริงควรใช้ blue-green deployment หรือ feature flag                                                     | —                                                                     |
| 2.3 | Backup ฐานข้อมูลขนาดใหญ่ระหว่างรับข้อมูล real-time จาก 200 เครื่องพร้อมกัน อาจทำให้ query ช้าลง                                                   | ใช้ scheduled `pg_dump` ที่ off-peak hour ใน Prototype ระบบจริงต้องใช้ read replica แยกสำหรับ backup ไม่ให้แย่ง I/O กับ write path หลัก (รายละเอียดตามบริบทโรงงานจริงดูหัวข้อ 4) | ISO/IEC 27001 Annex A.12.3 — Information Backup                       |
| 2.4 | เมื่อเพิ่ม field ใหม่ในอนาคต ต้องไม่ทำให้ consumer เดิมพัง                                                                                        | ออกแบบ payload แบบ additive-only ระบบจริงต้องมี `schema_version` ใน payload และ API versioning ที่ชัดเจน                                                                         | —                                                                     |
| 2.5 | การเปิดใช้ Modbus RTU บน CPU port หนึ่งจะยึด port นั้นทั้งหมด ทำให้ช่างเทคนิคแก้โปรแกรม PLC ผ่านสาย Serial เดิมพร้อมกันไม่ได้                     | ระบุ PLC รุ่นที่มีพอร์ตเดียว/สองพอร์ตในเอกสาร วางแผนหน้าต่างเวลาแยกงาน programming ออกจากช่วงเก็บข้อมูล หรือใช้ Ethernet module เสริมแทน                                         | Siemens S7-200 System Manual — ข้อจำกัดการใช้ Modbus Protocol Library |
| 2.6 | การอ่านค่าที่เป็น float/double word (เช่น Barrel Temperature) โดยไม่รับประกัน buffer consistency อาจเกิด "torn read" ทำให้ค่าอ่านผิดเพี้ยนแบบสุ่ม | ใช้ Modbus library ที่รับประกัน atomic multi-register read พร้อม sanity check ฝั่ง Backend (ค่าที่กระโดดเกิน physical limit ให้ flag เป็น suspect)                               | Modbus Application Protocol Specification                             |
| 2.7 | Modbus function 03/04/16 อ่าน/เขียนได้สูงสุด 125 holding registers ต่อ 1 request เมื่อเพิ่ม sensor ในอนาคตอาจเกินเพดานนี้                         | วางแผน logic แบ่ง (chunking) เป็นหลาย request โดยยังคง cycle time รวมให้อยู่ในเกณฑ์ที่ยอมรับได้                                                                                  | Modbus Application Protocol Specification                             |

> **หมายเหตุขอบเขต (2.5–2.7): เป็น Future Scope** เกี่ยวข้องกับตอนเชื่อมต่อ PLC จริงผ่าน Modbus เท่านั้น **ไม่ใช่ส่วนหนึ่งของ Prototype ปัจจุบัน** เพราะ Machine Simulator ที่ออกแบบไว้สวมบทบาทแทน PLC ทั้งก้อน จึงข้ามขั้นตอน "PLC poll ค่าจาก sensor ผ่าน Modbus" ไป — Simulator สร้างค่า Cycle Time, Pressure, Temperature ขึ้นเองแล้ว publish ผ่าน MQTT โดยตรง ในโค้ด Prototype จึงไม่มี Modbus ปรากฏเลย สามข้อนี้แสดงความเข้าใจ pipeline ทั้งสายสำหรับตอนขยายระบบไปเชื่อมเครื่องจักรจริง ไม่ใช่ข้อบกพร่องของการออกแบบ Prototype

---

## 3. วิศวกรรมไฟฟ้าและความปลอดภัย (Electrical Engineering & Safety)

| #    | ปัญหาที่พบ                                                                                                                                                                | แนวทางแก้ไข / สมมติฐานใน Prototype                                                                                                                                | อ้างอิงมาตรฐาน                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 3.1  | Path การ monitoring (PLC → Gateway → MQTT → Dashboard) มีจุดอ่อนที่ยอมรับได้ในงาน monitoring แต่ยอมรับไม่ได้ในงาน safety (network latency, broker ล่ม)                    | Emergency Shutdown ต้องเป็นวงจร hardwired แยกอิสระ ทำงานแบบ fail-safe ตัดไฟผ่าน safety relay/contactor โดยตรง ระบบ monitoring รับสถานะมา log และแจ้งเตือนเท่านั้น | IEC 60204-1, ISO 13849-1, IEC 62061, EUROMAP 78/78.1    |
| 3.2  | หาก Circuit Breaker ตัดไฟทั้งไลน์ทุกครั้งที่เครื่องเดียวมีปัญหา จะเสียเวลา restart ทุกเครื่องโดยไม่จำเป็น                                                                 | ทำ selective coordination study (time-current curve) ให้ CB ตัดเฉพาะจุดใกล้ fault ที่สุดก่อน                                                                      | IEC 60947-2, IEEE 242 "Buff Book"                       |
| 3.3  | สาย Ethernet ทองแดง (Cat5e/Cat6) จำกัดระยะ 100 เมตรต่อ segment โรงงานขนาดใหญ่มักมีระยะเกินนี้                                                                             | ใช้ Fiber optic + media converter สำหรับ backbone ระหว่างโซนที่ไกลกัน                                                                                             | IEEE 802.3, TIA/EIA-568                                 |
| 3.4  | RS-485 (Modbus) แบบไม่มี isolation จำกัดระยะเพียง 50 เมตรต่อ segment (คนละเพดานกับ Ethernet)                                                                              | ใช้ RS-485 repeater ขยายได้ถึง 1,000 เมตรต่อ segment เชื่อมต่อกันได้สูงสุด 9 ตัว รวมระยะไม่เกิน 9,600 เมตร                                                        | TIA/EIA-485-A                                           |
| 3.5  | อุปกรณ์ที่มี reference potential ต่างกันทำให้เกิดกระแสไม่พึงประสงค์ไหลผ่านสายสื่อสาร โดยเฉพาะเครื่องที่ใช้กระแสสูง (servo motor/heater) ทำให้ communication error แบบสุ่ม | ใช้ isolated RS-485 repeater ทุกจุดที่ไม่ได้ใช้ single-point grounding เดียวกัน                                                                                   | IEEE 1100 "Emerald Book", IEC 61000-5-2                 |
| 3.6  | Servo motor/VFD สร้างสัญญาณรบกวนสูง หากเดินสาย signal ขนานกับสายไฟกำลังโดยไม่มี shielding จะเกิด noise ทำให้ค่าที่อ่านได้ผิดเพี้ยน                                        | ใช้สาย shielded twisted pair แยก conduit จากสายไฟกำลัง พร้อม single-point grounding                                                                               | IEC 61000-6-2/6-4                                       |
| 3.7  | การเพิ่ม I/O module ให้เครื่องเก่าต้องเช็ค power budget (5VDC/24VDC) ของ CPU เดิม ถ้าเกินต้องมี external power supply เสริม                                               | ทำ site survey ก่อน retrofit ทุกเครื่อง คำนวณ power budget ตาม datasheet ของ CPU รุ่นนั้นก่อนเลือกซื้อ module                                                     | Siemens S7-200 System Manual — Power Budget Calculation |
| 3.8  | ความสั่นสะเทือนต่อเนื่องจากกลไก clamping/injection ทำให้ terminal แบบ screw หลวมตามเวลา เกิดสัญญาณหลุดเป็นระยะ (false OFFLINE)                                            | ใช้ terminal แบบ spring-loaded ในจุดที่ใกล้แหล่งสั่นสะเทือน                                                                                                       | —                                                       |
| 3.9  | การซ่อมบำรุงเครื่องเดียวควรทำได้โดยไม่กระทบเครื่องข้างเคียงในไลน์เดียวกัน                                                                                                 | ออกแบบ physical isolation (เช่น MCCB แบบ withdrawable ที่มีตำแหน่ง ON/OFF/TEST/ISOLATE) ไว้ตั้งแต่ต้น ไม่พึ่ง software toggle อย่างเดียว                          | IEC 60947-3, ISO 14118                                  |
| 3.10 | เครือข่ายฝั่ง IT (ERP, Office PC) และ OT (PLC, SCADA) ต้องแยกโซนชัดเจน ป้องกันภัยคุกคามจากฝั่ง office เข้ามารบกวนการทำงานของเครื่องจักร                                   | วางสถาปัตยกรรมผ่าน Industrial DMZ ตาม Purdue Model                                                                                                                | IEC 62443, Purdue Enterprise Reference Architecture     |

---

## 4. ข้อมูลอ้างอิงจากกรณีศึกษาจริง — SCG / Nawaplastic Industries (NPI)

โจทย์อิงบริบทโรงงานผลิตข้อต่อ PVC ด้วย Injection Molding ซึ่งตรงกับ **Nawaplastic Industries Co., Ltd. (NPI)** บริษัทในเครือ SCG Chemicals ก่อตั้งปี 1970 โรงงานหลักที่ Ban Khai จังหวัดระยอง

### 4.1 ข้อมูลที่ยืนยันได้จากแหล่งสาธารณะ

| ประเด็น                        | ข้อมูลที่พบ                                                                                                                                                      | แหล่งอ้างอิง                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Digital platform ที่มีอยู่แล้ว | SCGC มีระบบ "DRS by REPCO NEX" เชื่อมกับ Unified Operations Center (UOC) ที่ระยอง สำหรับบริหารประสิทธิภาพเครื่องจักรและสินทรัพย์ทั้งเครือ                        | SCGC News, ก.ย. 2025                       |
| ระดับ Automation               | Nawaplastic Industries มีความหนาแน่นของหุ่นยนต์ (robot density) ระดับ best-in-class ของโลก ในสายการผลิตท่อ ข้อต่อ และผลิตภัณฑ์ PVC สำเร็จรูป                     | SCGC News, ก.ค. 2025                       |
| สถานะธุรกิจ/ตลาดปัจจุบัน       | อุตสาหกรรมปิโตรเคมีอยู่ในช่วงตกต่ำที่รุนแรงและยาวนานกว่าปกติ ตลาดภูมิภาคเริ่มมีสัญญาณฟื้นตัว บริษัทเน้นกลยุทธ์ High Value-Added (HVA) products และ green polymer | SCGC News, ก.ค. 2025                       |
| วัฒนธรรม Safety/Quality        | รางวัล Prime Minister's Industry Award (ความปลอดภัย), Kano Quality Award (Gold), Thailand 5S Award (Diamond), CSR-DIW Continuous Award ต่อเนื่องถึงปี 2025       | npi-pipe.com/aboutus, SCGC News มี.ค. 2026 |
| โครงสร้างองค์กร                | มีหลายโรงงานในเครือข่ายภูมิภาค: ระยอง, สระบุรี, กัมพูชา, เมียนมา, อินโดนีเซีย, เวียดนาม                                                                          | nawaplastic.com                            |

**นัยต่อ Gap Analysis:** ข้อ 1.4 (Machine Heterogeneity) — robot density สูงหมายความว่าจำนวนคนเฝ้าเครื่องต่อไลน์ต่ำกว่าปกติมาก ระบบ monitoring จึงทำหน้าที่แทนสายตาคนได้จริง ข้อ 1.6 (ข้อมูลผู้บริหาร) — มี UOC/DRS อยู่แล้วในระดับเครือ Prototype ควรออกแบบให้เข้ากันได้ในเชิงแนวคิดกับแพลตฟอร์มนี้ และภาวะตลาดขาลงทำให้การควบคุมต้นทุนผ่าน digital monitoring มีความสำคัญเชิงกลยุทธ์สูงกว่าปกติ

### 4.2 ข้อมูลที่ไม่เปิดเผยต่อสาธารณะ — ใช้กรอบกฎหมาย/มาตรฐานแทนการเดา

| หัวข้อ                        | สิ่งที่ไม่เปิดเผย                                              | แนวทางที่ใช้แทน                                                                                                                                                                                                                     | อ้างอิงมาตรฐาน                                                                                                |
| ----------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Backup Strategy (2.3)         | ตารางเวลาการผลิตเฉพาะของ NPI ไม่เปิดเผย                        | สมมติสายการผลิตหลักเดินต่อเนื่อง 24/7 ใช้ Streaming replication (PostgreSQL WAL) แทน batch backup ที่ต้อง lock table ทำ full snapshot ในช่วง load ต่ำของ backend เอง เช่น ช่วงเปลี่ยนกะ                                             | Thailand Labour Protection Act B.E. 2541 มาตรา 23–25 (อนุญาตกะทำงานต่อเนื่องสำหรับงานที่ต้องดำเนินการไม่หยุด) |
| จำนวนพนักงาน/คนบนไลน์         | ตัวเลขระดับโรงงานไม่เปิดเผย (โจทย์ให้เฉพาะภาพรวมองค์กร 500 คน) | ประเมินจาก robot density สูงว่าอัตราส่วน operator ต่อเครื่องต่ำกว่า 1:1 สนับสนุนความสำคัญของ Dashboard/Alert ที่แม่นยำ                                                                                                              | —                                                                                                             |
| ยี่ห้อ/รุ่นเครื่องจักร        | ไม่เปิดเผยเป็นสาธารณะ                                          | ออกแบบ Machine Simulator แบบ generic ไม่ผูกกับ protocol เฉพาะยี่ห้อ รองรับทั้ง Modbus (PLC ตระกูล Siemens) และ EUROMAP 77/OPC UA สำหรับเครื่องรุ่นใหม่                                                                              | —                                                                                                             |
| การแยกสิทธิ์ IT/OT ตามหน้าที่ | ไม่เปิดเผยเฉพาะของ NPI                                         | Operator เข้าถึงเฉพาะเครื่องที่ดูแล / Line Supervisor เห็นภาพรวมไลน์ / Maintenance เข้าถึง OT zone แยกจาก IT / Management เข้าถึงเฉพาะ Executive dashboard ผ่าน IT zone / System Admin เข้า Industrial DMZ ผ่าน MFA พร้อม audit log | IEC 62443 (Zone & Conduit Model)                                                                              |

### 4.3 ตัวอย่างตัวเลขประกอบ (อิง Protocol Spec ไม่ผูกกับบริษัทใดบริษัทหนึ่ง)

| ประเด็น                  | ตัวอย่างประกอบ                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Torn Read (2.6)          | `Barrel Temperature` เป็น float 4 byte (2 register) หากอ่านทีละ register แยกกันอาจได้ค่าผสมระหว่างรอบเก่า-ใหม่ เช่น register แรกได้ 220.5°C (รอบเก่า) register ที่สองได้ค่าที่อัปเดตแล้วเป็นรอบใหม่ ประกอบกันได้ค่าที่ไม่เคยมีจริง ควร validate ค่าที่เปลี่ยนเกิน ±5°C ภายใน 1 cycle |
| Payload Limit (2.7)      | เครื่อง 1 เครื่องมี field ตามโจทย์ประมาณ 5–10 register ยังไม่เกิน 125 register limit ต่อ request แต่หากเพิ่ม multi-zone temperature หรือ energy sensor ในอนาคต อาจเกินเพดานในเครื่องขนาดใหญ่ ต้องออกแบบ chunking ล่วงหน้า                                                            |
| EUROMAP 77 Mapping (1.7) | มาตรฐานกำหนดกลุ่มข้อมูลเป็น `MachineData` / `JobData` / `ProcessData` ซึ่ง map ตรงกับโจทย์ได้เกือบสมบูรณ์: Job Number/Product Code → JobData, Cycle Time/Shot Count → ProcessData, Machine Status → MachineData.OperationalState                                                     |

---

## 5. ตารางสรุปมาตรฐานอ้างอิงทั้งหมด

| หมวด                                    | มาตรฐาน                                  | ครอบคลุมประเด็น                           |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Manufacturing Integration               | ANSI/ISA-95 (IEC 62264)                  | Enterprise-Control System Integration     |
| Manufacturing KPI                       | ISO 22400-2                              | OEE, Availability/Performance/Quality     |
| Business Continuity                     | ISO 22301                                | RTO/RPO, Disaster Recovery                |
| Information Security                    | ISO/IEC 27001                            | Backup, Access Control                    |
| Industrial Protocol (Injection Molding) | EUROMAP 77 / OPC 40077                   | IMM–MES Data Exchange (OPC UA)            |
| Industrial Safety Interface             | EUROMAP 78 / 78.1                        | Safety Device Acknowledgement             |
| Functional Safety                       | IEC 60204-1, ISO 13849-1, IEC 62061      | Emergency Shutdown, Safety Circuits       |
| Machinery Safety                        | ISO 14118, IEC 60947-3                   | Unexpected Start-up Prevention, Isolation |
| Protective Coordination                 | IEC 60947-2, IEEE 242                    | Circuit Breaker Selective Coordination    |
| Network Physical Layer                  | IEEE 802.3, TIA/EIA-568, TIA/EIA-485-A   | Ethernet / RS-485 Distance Limits         |
| Grounding                               | IEEE 1100, IEC 61000-5-2                 | Ground Potential, Single-Point Earth      |
| EMC                                     | IEC 61000-6-2/6-4                        | Industrial Noise Immunity/Emission        |
| OT Security                             | IEC 62443                                | IT/OT Network Segmentation                |
| Fieldbus Protocol                       | Modbus Application Protocol Spec         | Register Limits, Function Codes           |
| OPC Framework                           | IEC 62541                                | OPC Unified Architecture                  |
| Labour Regulation                       | Thailand Labour Protection Act B.E. 2541 | Working Hours, Continuous Shift Operation |

---

## สรุปแนวคิด

Production Monitoring System ที่ดีไม่ใช่แค่การเขียนโค้ดให้รับข้อมูลได้ แต่ต้องเข้าใจว่าข้อมูลนั้นจะถูกใช้ตัดสินใจอย่างไร ระบบจะพังแบบไหนได้บ้าง และเครื่องจักรจริงมีข้อจำกัดทางกายภาพอะไรที่ diagram บนกระดาษมองไม่เห็น การอ้างอิงมาตรฐานสากลที่มีชื่อจริงในแต่ละประเด็นแสดงให้เห็นว่าการวิเคราะห์นี้อิงหลักวิศวกรรมที่ยอมรับในอุตสาหกรรม ไม่ใช่ความเห็นส่วนตัว

## แหล่งอ้างอิงข้อมูล SCG/Nawaplastic

- npi-pipe.com/aboutus — ประวัติบริษัทและรางวัล
- nawaplastic.com/en/business-solution, nawaplastic.com/en/about/npi-business — โครงสร้างธุรกิจและที่ตั้งโรงงาน
- SCGC News (scgchemicals.com) — "SCGC Strengthens Competitiveness..." (ก.ค. 2025), "SCGC Unveils World-First Smart Digital Solution..." (ก.ย./ต.ค. 2025), "SCGC Wins CSR-DIW and CSR-DIW Continuous Awards 2025" (มี.ค. 2026)
- Thailand Labour Protection Act B.E. 2541 มาตรา 23–25

_หมายเหตุ: ข้อมูลข้างต้นเป็นข้อมูลสาธารณะระดับองค์กร ไม่ใช่ข้อมูลปฏิบัติการภายในระดับโรงงาน (เช่น จำนวนพนักงานจริง, ยี่ห้อเครื่องจักร, ตารางกะ) ซึ่งไม่ได้เปิดเผยต่อสาธารณะ ตัวเลข/สมมติฐานที่เกี่ยวข้องในเอกสารนี้จึงระบุไว้ชัดเจนว่าเป็น Assumption ไม่ใช่ข้อเท็จจริงที่ยืนยันได้_
