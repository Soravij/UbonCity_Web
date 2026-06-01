# Transport V2 Routes Workspace Handoff

ก้อน `Transport V2 Routes Review / Path Editor` ยังไม่ close แล้ว
ตอนนี้สถานะคือโครงถูกทาง แต่ parity กับ `Base Map Annotation Workspace` ยังไม่สมบูรณ์

## ทำไปแล้ว

- แยก fullscreen เดิมออกเป็น 2 หน้า
  - `collector/server/public/transport-v2-routes-review.html`
  - `collector/server/public/transport-v2-path-editor.html`
- `Base Map Annotation` ส่ง `annotation_render_payload` แล้ว
  - `base_layer_url`
  - `label_layer`
  - `overlay_layers`
  - `bounds`
  - `viewbox`
- review/path ใช้ layered payload แล้ว
- ดึง geometry helper ออกเป็น shared module
  - `collector/server/public/transport-v2-map-geometry.js`
- review/path ใช้ geometry model เดียวกับ Base Map Annotation มากขึ้น
- เพิ่ม post-zoom rerender lifecycle
- เก็บ resize recovery และ cache invalidation หลัก ๆ แล้ว

## สิ่งที่ยังค้าง

- ความคมและ quality ระหว่าง zoom ยังไม่เท่า `Base Map Annotation Workspace`
- compositing และ render behavior ยังมีความต่างบางจุด
- ยังต้อง audit ต่อใน browser จริงเรื่อง blur/sharpness หลัง zoom และ pan
- งานนี้ยังเสี่ยง regression จาก gesture, resize, และ render lifecycle

## ข้อสรุปเชิงสถาปัตยกรรม

- schema ใหม่ไม่ควรถอด
- ปัญหาหลักตอนนี้ไม่ใช่ payload แล้ว
- ปัญหาอยู่ที่ frontend render/compositing parity กับ `Base Map Annotation Workspace`

## คำแนะนำ

- พักก้อนนี้ไว้ก่อน
- ไปปิดส่วนอื่นของเว็บที่ impact กว้างกว่า
- ค่อยกลับมาทำก้อนนี้เป็น refinement track แยก

## ถ้ากลับมาทำต่อ

1. เทียบ zoom/compositing lifecycle กับ `transport-v2-base-maps-page.js`
2. ตรวจ browser behavior จริงของ blur หลัง zoom
3. แยกให้ชัดว่าปัญหามาจาก
   - viewport compositing
   - layer render order
   - asset quality
   - rerender timing

อย่ากลับไปแก้ payload/schema อีกจนกว่าจะพิสูจน์ได้ว่าต้นเหตุอยู่ upstream จริง
