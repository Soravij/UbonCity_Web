# field_working writers + handoff tab audit

Date: 2026-08-13
Commit: 962da87
Status: READ-ONLY scan

---

## 1) analyzed → field_working: is it a legal edge?

**NO.**

Place transition rules (`repository.mjs:517`):
```
analyzed: new Set(["generated"]),
```

From `analyzed`, only `generated` is a legal production transition.
`field_working` is reachable from:
- `ready_for_content → field_working` (`repository.mjs:520`)
- `field_review → field_working` (`repository.mjs:522`)

`canTransition("place", "production", "analyzed", "field_working")` returns `false`.

---

## 2) What happens when "reopen_in_progress" is clicked on head=analyzed?

**Assignment advances to `in_progress`. Production state stays at `analyzed`. HTTP 200. Silent strip.**

Call chain:
1. UI button `#btn-assignment-update-state` (`index.html:569`) → `updateAssignmentState()` (`app.js:9842`)
2. Action `reopen_in_progress` maps to `in_progress` (`app.js:120`)
3. `PATCH /api/assignments/:id/state` (`index.mjs:10936`) → `repo.updateAssignmentState(assignmentId, "in_progress", ...)` (`index.mjs:10988`)
4. Inside `updateAssignmentStateInternal` (`repository.mjs:5558`):
   - Assignment state transition `assigned → in_progress` passes `assertValidTransition` (`repository.mjs:5600`)
   - `requestedPlaceFieldProductionState` = `"field_working"` (`repository.mjs:5608-5610`)
   - `canTransition("place", "production", "analyzed", "field_working")` returns `false` (`repository.mjs:5621`)
   - `placeFieldProductionState` = `null` — production state write is skipped (`repository.mjs:5622-5623`)
   - Error logged: `[workflow-transition] skipped production sync` (`repository.mjs:5624-5631`)
   - Assignment row updated to `in_progress` anyway (`repository.mjs:5600`)
   - Returns 200 with updated assignment

**Contradicts `audit/runtime-backward-widget-check.md`**: that report says `field_working` "ไปไม่ถึงเลย". This is wrong — the writer exists and fires correctly when preconditions are met (head at `ready_for_content` or `field_review`). What fails is the specific `analyzed → field_working` path, which is correctly blocked by `canTransition`. The audit `step5-backward-walk.md` is closer to correct.

---

## 3) Guard preventing field pack `ready_for_field` when head=analyzed?

**No guard exists.**

- `POST /api/items/:id/field-packs` (`index.mjs:12551`): no `production_state` check
- `PUT /api/field-packs/:fieldPackId` (`index.mjs:12586`): no `production_state` check
- `POST /api/items/:id/field-pack/regenerate` (`index.mjs:12633`): checks `cleanContext.completeness.has_minimum_required` but not `production_state`
- `createFieldPackInternal` (`repository.mjs:9762`): no `production_state` validation
- `normalizeFieldPackPayload` (`repository.mjs:2497`): no `production_state` check

The only guard is `validateAssignmentCreateFieldPackPrerequisites` (`index.mjs:2950`) which checks `fieldPack.status === "ready_for_field"` before allowing **assignment creation** — but this does not prevent the field pack itself from being created or updated to `ready_for_field` at any production state.

---

## 4) Summary: what is the actual gap?

**(ค) ทั้งสองอย่าง**

1. **No UI button to fire `in_progress` from `analyzed`**: The button exists (`reopen_in_progress`, `app.js:53`) but only for assignment state `assigned`. Even if clicked, `canTransition` silently strips the production_state advance. The assignment moves but the head stays.

2. **Handoff tab filter does not check `production_state`**: `resolveQueueBucket` (`app.js:737-775`) gates handoff on `hasFieldPack && isAssignmentContextReady(fieldPackStatus)` (`app.js:768`). It does NOT filter on `production_state`. So an item with `head=analyzed` + `field_pack.status=ready_for_field` + no accepted assignment will appear on the handoff tab.

**Root cause**: There is no guard at field pack creation/update time that ties `field_pack.status` to `production_state`. The handoff filter trusts `field_pack.status` as the sole readiness signal, which can be set independently of the production ladder.

---

## Prior audit corrections

| Report | Claim | Correct? | Evidence |
|--------|-------|----------|----------|
| `audit/runtime-backward-widget-check.md` | `field_working` "ไปไม่ถึงเลย" | **ผิด** | Writer fires at `repository.mjs:5608-5651` when head is `ready_for_content` or `field_review`. The `canTransition` gate at line 5621 is the blocker only for `analyzed → field_working`. |
| `audit/step5-backward-walk.md` | `PATCH /api/assignments/:id/state` = `in_progress` ย้าย head ไป `field_working` ได้จริง | **ถูกบางส่วน** | จริงเฉพาะเมื่อ head อยู่ที่ `ready_for_content` หรือ `field_review`. ถ้า head = `analyzed`, production state ถูก strip เงียบ |
