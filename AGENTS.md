# AGENTS.md instructions for D:\UbonCity_Web

<INSTRUCTIONS>
- ตอบตรงไปตรงมา ไม่อวย
- ถ้ามีทางที่ดีกว่า ให้เสนอความเห็นแย้งได้
- เน้นความถูกต้องก่อนความเร็ว
- ถ้าข้อมูลไม่พอหรือเสี่ยง ให้ถามก่อนแก้
- อย่าทำงานยาวแบบ autonomous โดยไม่จำเป็น
- แยกงานเป็นรอบสั้น ๆ: `review`, `plan`, `fix`
- เวลาแก้ไฟล์ ให้แก้แบบจำกัดขอบเขตและอธิบายผลกระทบสั้น ๆ
- ถ้าจะเสนอ patch ให้เสนอแบบอ่านง่ายและตรวจได้
- ถ้าใช้เครื่องมือช่วยวิเคราะห์ ให้บอกข้อจำกัดของมันตรง ๆ
</INSTRUCTIONS>

## DeepSeek-safe format

- Apply this format by default to every DeepSeek prompt.
- Treat this as the enforced default for DeepSeek via Continue.
- This section takes precedence over the longer workflow template below for DeepSeek via Continue.
- Use DeepSeek mainly for read-only scan/review work.
- Prefer concise prompts over policy-heavy prompts.
- Keep DeepSeek prompts focused on one step only.
- Treat DeepSeek as a draft/implementation assistant, not the final judge.
- Keep Codex responsible for final review, final architecture, and scope control.

## DeepSeek limitations (hard)

- Effective context limit is small. Keep prompts well below ~8K tokens.
- Do not use `@codebase` in DeepSeek prompts.
- Do not rely on parallel tool calls.
- Keep each prompt timeout-safe and short.
- Do not ask DeepSeek to do autonomous multi-step work.
- Do not rely on DeepSeek for multi-file code writing by default.

## DeepSeek role split

- DeepSeek default role:
  - read files
  - scan usage
  - build inventory
  - summarize findings
  - point out risks
- Codex default role:
  - final plan
  - final architecture decision
  - code changes
  - verification
  - final review

### When to use DeepSeek

- Use DeepSeek when the main task is reading or scanning files to gather exact results.
- Good DeepSeek tasks:
  - find usages
  - compare diff scope
  - list runtime-critical references
  - identify likely impact areas
  - summarize exact findings from specified files

### When not to use DeepSeek

- Do not use DeepSeek by default for:
  - multi-file refactor
  - schema change implementation
  - cross-layer code changes
  - test repair
  - fix + verify in one round
- In those cases, Codex should implement directly unless a narrow read-only scan is needed first.

### DeepSeek-safe prompt rules

- Use simple language.
- Use short sections.
- Avoid unnecessary explanation.
- Avoid duplicate constraints.
- Avoid deep background context unless it is required to prevent wrong edits.
- Avoid more than one stage per prompt.
- Avoid asking for multiple independent tasks in one prompt.
- Avoid forcing design rationale, implementation, and review in one round.
- Do not use nested bullet lists.
- Do not use a long negative list. Keep constraints to 4 bullets or fewer when possible.
- Do not ask DeepSeek to choose among options.
- Prefer read-only prompts unless there is a strong reason to ask for edits.

### Preferred DeepSeek-safe output shape

Use this lighter format by default for DeepSeek:

1. `Stage`
2. `Prompt for DeepSeek`
3. `Handoff Point`

If the workflow still depends on DeepSeek output before Codex can act, do not emit `Prompt for Codex` yet.
Do not expand into the longer 4-part workflow template unless the user explicitly asks for that stricter format.

### DeepSeek-safe prompt template

```text
Task: [one short sentence]

Files: [path1, path2]

Constraints:
- [specific rule 1]
- [specific rule 2]

Output format:
1. Files changed
2. What changed
3. Risks / needs Codex review

Stop.
```

### Preferred read-only scan template

```text
Task: [scan or review goal in one sentence]

Files: [path1, path2]

Constraints:
- Read only
- No code changes
- Quote exact function names and line references if visible
- If not found, say not found

Output format:
1. Findings
2. Runtime-critical usages
3. Risks / needs Codex review

Stop.
```

### DeepSeek-safe fallback rule

- If a previous DeepSeek prompt stalled, failed repeatedly, or caused the model to wander, rewrite the next prompt into the lighter template above before sending it.
- When in doubt, choose the shorter DeepSeek prompt.
- Do not force the full 4-part workflow format onto DeepSeek unless the user explicitly asks for that stricter format.

## Required Prompt Template

- Use this section only when the user explicitly asks for the full workflow template or explicitly asks for separate DeepSeek/Codex prompts in the long form.
- For DeepSeek via Continue, the default remains the shorter DeepSeek-safe format above.
- เมื่อผู้ใช้ขอ prompt สำหรับ workflow ที่ใช้ external model เช่น DeepSeek ร่วมกับ Codex ต้องตอบตาม template นี้เท่านั้น
- ห้ามรวม prompt ของ DeepSeek และ Codex เป็นชุดเดียว
- ห้ามข้ามหัวข้อ
- สำหรับ DeepSeek via Continue ห้ามใช้ `@codebase`
- Prompt ฝั่ง DeepSeek ต้องคุม scope ไม่ให้ลามงาน และต้องสั่งชัดว่าถ้าไม่แน่ใจให้ระบุ `needs Codex review`
- Prompt ฝั่ง Codex ต้องทำหน้าที่ review/final เท่านั้น ไม่ใช่รับบท DeepSeek ซ้ำ
- ถ้ายังไม่มี output จริงจาก DeepSeek และ workflow นั้นต้องรอ handoff ก่อน ห้ามส่ง `Prompt สำหรับ Codex` ล่วงหน้า ให้ส่งเฉพาะ `Prompt สำหรับ DeepSeek` และ `Handoff Point` ก่อน แล้วรอข้อมูลกลับมาค่อยสร้าง prompt ฝั่ง Codex ต่อ
- ถ้าอยู่ stage `review` หรือ `plan` ห้ามให้ prompt เขียนโค้ดหรือเสนอ patch
- ทุก prompt ต้องระบุ `stage`, `scope`, `allowed files`, `hard constraints`, และ `handoff point` ชัดเจน

ใช้รูปแบบนี้เฉพาะเมื่อผู้ใช้ขอแบบเต็มเท่านั้น:

### 1. Stage
```text
review
```
หรือ
```text
plan
```
หรือ
```text
fix
```

### 2. Prompt สำหรับ DeepSeek
```text
บทบาท:
[ระบุบทบาทแบบ draft/support เท่านั้น]

stage:
[review|plan|fix]

เป้าหมาย:
[ระบุเป้าหมายของรอบนี้สั้นและชัด]

scope:
[ระบุขอบเขตงานแบบแคบ ตรวจสอบได้]

allowed files:
- [path 1]
- [path 2]
- [path 3]

hard constraints:
- ห้ามขยาย scope เอง
- ห้ามแตะ backend
- ห้าม refactor ทั้งระบบ
- ห้ามอ้างไฟล์นอก allowed files
- ถ้าไม่แน่ใจห้ามเดา
- ให้ระบุ needs Codex review เมื่อเรื่องนั้นควรให้ Codex ตัดสิน
- [เพิ่ม constraint ตามงาน]

งานที่ต้องทำ:
[ระบุสิ่งที่ต้องให้ DeepSeek ทำแบบจำกัดขอบเขต]

สิ่งที่ห้ามทำ:
- [ข้อห้ามเฉพาะงาน]
- [เช่น ห้ามเขียนโค้ด]
- [เช่น ห้ามเสนอ patch]
- [เช่น ห้ามตัดสิน final architecture]

รูปแบบคำตอบ:
[ระบุหัวข้อคำตอบที่ต้องการอย่างชัดเจน]

handoff instruction:
หลังตอบเสร็จ ให้หยุดที่ draft เท่านั้น
ห้ามไป stage ถัดไป
ถ้ามีจุดไม่ชัดหรือเสี่ยง ให้เขียนว่า needs Codex review
```

### 3. Prompt สำหรับ Codex
```text
บทบาท:
[ระบุว่าเป็น reviewer/final decision]

stage:
[review|plan|fix]

เป้าหมาย:
[ระบุเป้าหมายของรอบนี้]

scope:
[ระบุขอบเขตเดียวกับ DeepSeek หรือแคบกว่า]

input จาก DeepSeek:
[วาง output จาก DeepSeek ที่นี่]

hard constraints:
- ห้ามขยาย scope เอง
- ห้ามแตะ backend
- ห้าม refactor ทั้งระบบ
- [เพิ่ม constraint ตามงาน]
- [ถ้า stage review/plan: ห้ามเขียนโค้ดหรือเสนอ patch]

งานที่ต้องทำ:
- validate สิ่งที่ถูก
- correct สิ่งที่คลุมเครือหรือผิด
- ตัดสิ่งที่เกิน scope
- สรุป final verdict/final plan/final execution gate ตาม stage

สิ่งที่ห้ามทำ:
- ห้ามเดาแทน DeepSeek ถ้า input ไม่ชัด
- ห้ามข้าม stage
- ห้ามรับข้อเสนอของ DeepSeek ทั้งหมดโดยไม่ review
- [ข้อห้ามเฉพาะงาน]

รูปแบบคำตอบ:
[ระบุหัวข้อคำตอบสุดท้ายที่ต้องการอย่างชัดเจน]

decision gate:
- อะไรผ่าน
- อะไรไม่ผ่าน
- ต้องส่งต่อไปรอบถัดไปหรือไม่
```

### 4. Handoff Point
```text
ให้ส่ง output จาก DeepSeek กลับมาทันทีหลังจบ stage นี้
```

- ถ้าผู้ใช้ขอ “prompt รอบที่ 1/2/3” หรือ “ช่วยแยก prompt DeepSeek/Codex” ต้องตอบออกมาตาม 4 ส่วนนี้เท่านั้น
- ถ้า prompt ไหนไม่มี `allowed files` หรือ `hard constraints` ให้ถือว่ายังไม่พร้อมใช้งาน
- ถ้าเป็นงานที่เสี่ยงลาม ให้ prompt ฝั่ง DeepSeek ต้องใส่ข้อห้ามเพิ่ม เช่น:
  - ห้ามเสนอเกิน 3 ทางเลือก
  - ห้ามเสนอไฟล์นอก list
  - ห้ามเสนอ component ใหม่เกินจำนวนที่กำหนด
- ถ้ายังอยู่ก่อน handoff จาก DeepSeek ให้ถือว่ายกเว้นชั่วคราวเรื่องการต้องส่งครบ 4 ส่วน โดยอนุญาตให้ส่งเฉพาะ:
  - `Stage`
  - `Prompt สำหรับ DeepSeek`
  - `Handoff Point`
- หลังได้รับ output จริงจาก DeepSeek แล้ว ค่อยส่ง:
  - `Prompt สำหรับ Codex`
  - หรือ workflow ครบชุดสำหรับรอบถัดไป
- เป้าหมายของ template นี้คือให้ DeepSeek เป็นตัวร่าง และให้ Codex เป็นตัวตัดสิน ไม่ใช่สลับบทบาทกัน
