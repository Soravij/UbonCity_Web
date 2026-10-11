import assert from "node:assert/strict";
import test from "node:test";

import { isUsefulArticleSection } from "../collector/sources/adapters/manual.mjs";
import { buildEvidenceCandidatesForNormalized } from "../server/evidence-candidates.mjs";

test("A: shop-name-only section is dropped", () => {
  assert.equal(
    isUsefulArticleSection("Blendstorm Coffee Roasters (ร้านเบลนสตรอม) OFFICIAL", {
      headline: "ร้าน Blendstorm Coffee Roasters | รีวิวร้านอาหาร on wongnai.com",
      title: "Blendstorm Coffee Roasters",
    }),
    false,
  );
});

test("B: photo-gallery title section is dropped", () => {
  assert.equal(
    isUsefulArticleSection("รูปทั้งหมดร้าน Tree Cafe Bar & Restaurant Nai Mueang", {
      headline: "รูปทั้งหมดร้าน Tree Cafe Bar & Restaurant Nai Mueang on wongnai.com",
      title: "Tree Cafe Bar & Restaurant Nai Mueang",
    }),
    false,
  );
});

test("C: real descriptive section that mentions the name is kept", () => {
  assert.equal(
    isUsefulArticleSection("สิ่งก่อสร้างภายในทุ่งศรีเมือง: ภายในมีอนุสาวรีย์ เสาหลักเมือง และหอพระพุทธรูปสำคัญหลายแห่ง", {
      headline: "ทุ่งศรีเมือง",
      title: "ทุ่งศรีเมือง",
    }),
    true,
  );
});

test("D: 8 distinct long article sections all become article_section mention blocks", () => {
  const sections = [
    "The riverside walkway offers wide paths with plenty of shade trees for visitors in the afternoon hours.",
    "A small museum on the north side displays old photographs, tools and household items from past decades.",
    "Local vendors set up stalls near the entrance every weekend selling snacks, drinks and handmade crafts.",
    "The main hall hosts community events throughout the year including music nights and seasonal fairs.",
    "Families often bring children to the playground area which is fenced and surrounded by soft grass.",
    "Guided walking tours begin from the information desk and take roughly forty minutes to complete.",
    "A quiet reading corner with benches and lamps sits beside the garden for those who prefer calm.",
    "Parking is available behind the building and there is a ramp for visitors who need step-free access.",
  ];
  for (const s of sections) assert.ok(s.length > 60);
  const normalized = {
    title: "Test Place",
    article_section_texts: sections,
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const blocks = candidates.filter(
    (c) => c.block_type === "mention" && c.payload_json?.field === "article_section",
  );
  assert.equal(blocks.length, 8);
});
