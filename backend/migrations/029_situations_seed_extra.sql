-- 029_situations_seed_extra.sql
-- Add solo, rainy-day, local-food situations with 4-language translations.

INSERT IGNORE INTO situations (slug, sort_order, is_active) VALUES
  ('solo', 5, 1),
  ('rainy-day', 6, 1),
  ('local-food', 7, 1);

INSERT IGNORE INTO situation_translations (situation_id, lang, title)
SELECT s.id, t.lang, t.title FROM situations s
JOIN (
  SELECT 'solo' AS slug, 'th' AS lang, 'เที่ยวคนเดียว' AS title
  UNION ALL SELECT 'solo','en','Solo Trip'
  UNION ALL SELECT 'solo','zh','独自旅行'
  UNION ALL SELECT 'solo','lo','ທ່ຽວຄົນດຽວ'
  UNION ALL SELECT 'rainy-day','th','วันฝนตก'
  UNION ALL SELECT 'rainy-day','en','Rainy Day'
  UNION ALL SELECT 'rainy-day','zh','雨天好去处'
  UNION ALL SELECT 'rainy-day','lo','ມື້ຝົນຕົກ'
  UNION ALL SELECT 'local-food','th','กินของถิ่น'
  UNION ALL SELECT 'local-food','en','Local Food'
  UNION ALL SELECT 'local-food','zh','当地美食'
  UNION ALL SELECT 'local-food','lo','ກິນຂອງທ້ອງຖິ່ນ'
) t ON t.slug = s.slug;
