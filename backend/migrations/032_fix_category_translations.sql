-- Migration 032: Fix category_translations — rewrite th/zh/lo with correct UTF-8 values
-- Uses ON DUPLICATE KEY UPDATE via uq_category_lang (category_id, lang)
-- Matched by categories.slug, never by hardcoded id.
-- Sets both `title` (NOT NULL) and `name` columns.

SET NAMES utf8mb4;

-- attractions
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'สถานที่ท่องเที่ยว', 'สถานที่ท่องเที่ยว' FROM categories WHERE slug = 'attractions'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '景点', '景点' FROM categories WHERE slug = 'attractions'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ສະຖານທີ່ທ່ອງທ່ຽວ', 'ສະຖານທີ່ທ່ອງທ່ຽວ' FROM categories WHERE slug = 'attractions'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

-- activities
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'กิจกรรม', 'กิจกรรม' FROM categories WHERE slug = 'activities'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '活动', '活动' FROM categories WHERE slug = 'activities'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ກິດຈະກຳ', 'ກິດຈະກຳ' FROM categories WHERE slug = 'activities'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

-- hotels
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'โรงแรม', 'โรงแรม' FROM categories WHERE slug = 'hotels'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '酒店', '酒店' FROM categories WHERE slug = 'hotels'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ໂຮງແຮມ', 'ໂຮງແຮມ' FROM categories WHERE slug = 'hotels'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

-- cafes (en also needs fix: was 'Cafe' → 'Cafes')
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'en', 'Cafes', 'Cafes' FROM categories WHERE slug = 'cafes'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'คาเฟ่', 'คาเฟ่' FROM categories WHERE slug = 'cafes'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '咖啡馆', '咖啡馆' FROM categories WHERE slug = 'cafes'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ຄາເຟ່', 'ຄາເຟ່' FROM categories WHERE slug = 'cafes'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

-- restaurants
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'ร้านอาหาร', 'ร้านอาหาร' FROM categories WHERE slug = 'restaurants'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '餐厅', '餐厅' FROM categories WHERE slug = 'restaurants'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ຮ້ານອາຫານ', 'ຮ້ານອາຫານ' FROM categories WHERE slug = 'restaurants'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

-- transport
INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'th', 'การเดินทาง', 'การเดินทาง' FROM categories WHERE slug = 'transport'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'zh', '交通', '交通' FROM categories WHERE slug = 'transport'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);

INSERT INTO category_translations (category_id, lang, title, name)
SELECT id, 'lo', 'ການເດີນທາງ', 'ການເດີນທາງ' FROM categories WHERE slug = 'transport'
ON DUPLICATE KEY UPDATE title = VALUES(title), name = VALUES(name);
