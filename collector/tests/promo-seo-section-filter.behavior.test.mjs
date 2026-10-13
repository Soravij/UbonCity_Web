import assert from "node:assert/strict";
import test from "node:test";

import { isLikelyPromoOrSeoSection } from "../collector/sources/adapters/manual.mjs";

// Real section_texts from source_records id 24 (sangob.cafe) and id 22 (wabbbb.com), copied verbatim.
const SANGOB_NAV_STACKED = "เมนู Home About Menu Promotion Reward Wallet Contact Home About Menu Promotion Reward Wallet Contact SANGOB สงบ — คาเฟ่ย่านเมืองเก่า อุบลราชธานี ร้านกาแฟเล็กๆ สไตล์มินิมอล บน ถ.พรหมเทพ ห่างจากวัดหลวงเพียงนิดเดียว";
const SANGOB_EMOJI_PROMO = "เริ่มแล้ว❗ไทยช่วยไทย พลัส+ ✅ใช้สิทธิ์ได้เลยทุกวัน";
const SANGOB_WALLET_PROMO = "แค่คุณเท่านั้น..เพียงเติมเงินเข้า 𝗦𝗔𝗡𝗚𝗢𝗕 𝗪𝗮𝗹𝗹𝗲𝘁 500.- บาทขึ้นไป";
const WABBBB_CITY_KEYWORDS = "ร้านนั่งชิวอุบล เปิดใหม่ในย่านเมืองเก่า คาเฟ่อุบล";
const SANGOB_PROSE_A = "เริ่มจากช่างภาพที่หลงรักกลิ่นกาแฟ จนกลายเป็นบาริสต้าในวันนี้ — เราเลือกใช้เมล็ด อาราบิก้าจากไร่แม่แดดน้อย เชียงใหม่ คั่วใหม่ทุกสัปดาห์";
const SANGOB_PROSE_B = "ที่นี่…ไม่ใช่แค่ดื่มกาแฟ — แต่คือช่วงเวลาเงียบๆ ที่คุณได้พักใจ";

test("flags nav-stacked promo text from source_records id 24", () => {
  assert.equal(isLikelyPromoOrSeoSection(SANGOB_NAV_STACKED), true);
});

test("flags emoji and wallet promo markers from source_records id 24", () => {
  assert.equal(isLikelyPromoOrSeoSection(SANGOB_EMOJI_PROMO), true);
  assert.equal(isLikelyPromoOrSeoSection(SANGOB_WALLET_PROMO), true);
});

test("flags short Ubon keyword-stuffed text from source_records id 22", () => {
  // Pins current behavior: the city-keyword rule cuts this. Reviewer should confirm intent.
  assert.equal(isLikelyPromoOrSeoSection(WABBBB_CITY_KEYWORDS), true);
});

test("does not cut ordinary article prose from source_records id 24", () => {
  assert.equal(isLikelyPromoOrSeoSection(SANGOB_PROSE_A), false);
  assert.equal(isLikelyPromoOrSeoSection(SANGOB_PROSE_B), false);
});

test("does not cut ordinary wikipedia-style English text", () => {
  assert.equal(
    isLikelyPromoOrSeoSection(
      "Ubon Ratchathani is a province in northeastern Thailand. The city is known for its annual candle festival, which is held each July in the old town."
    ),
    false
  );
});

test("does not cut ordinary wikipedia-style Thai text", () => {
  assert.equal(
    isLikelyPromoOrSeoSection("อุบลราชธานี เป็นจังหวัดในภาคตะวันออกเฉียงเหนือของประเทศไทย มีประวัติศาสตร์ยาวนานและเป็นที่รู้จักจากงานเทียนพรรษา"),
    false
  );
});

test("nav-word near-miss (fewer than three consecutive nav words) is not flagged", () => {
  assert.equal(isLikelyPromoOrSeoSection("The about section and the menu are listed below."), false);
});

test("city-keyword rule does not apply at 120 characters or more", () => {
  const long = `ร้านนั่งชิวอุบล ${"ก".repeat(120)} คาเฟ่อุบล`;
  assert.ok(long.length >= 120);
  assert.equal(isLikelyPromoOrSeoSection(long), false);
});

test("empty and nullish input is not flagged", () => {
  assert.equal(isLikelyPromoOrSeoSection(""), false);
  assert.equal(isLikelyPromoOrSeoSection(null), false);
  assert.equal(isLikelyPromoOrSeoSection(undefined), false);
});
