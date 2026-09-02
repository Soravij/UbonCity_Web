-- 028_situations.sql
-- Situations and translations for trip planning.

CREATE TABLE IF NOT EXISTS situations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  image_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_situation_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS situation_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  situation_id INT NOT NULL,
  lang VARCHAR(16) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_situation_lang (situation_id, lang),
  CONSTRAINT fk_situation_translations_situation
    FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO situations (slug, sort_order, is_active) VALUES
  ('day-trip', 1, 1),
  ('budget-500', 2, 1),
  ('couple', 3, 1),
  ('family', 4, 1);

INSERT IGNORE INTO situation_translations (situation_id, lang, title)
SELECT s.id, t.lang, t.title FROM situations s
JOIN (
  SELECT 'day-trip' AS slug, 'th' AS lang, 'เที่ยวหนึ่งวัน' AS title
  UNION ALL SELECT 'day-trip','en','One-day Trip'
  UNION ALL SELECT 'day-trip','zh','一日游'
  UNION ALL SELECT 'day-trip','lo','ທ່ຽວມື້ດຽວ'
  UNION ALL SELECT 'budget-500','th','งบ 500'
  UNION ALL SELECT 'budget-500','en','Budget 500'
  UNION ALL SELECT 'budget-500','zh','500泰铢预算'
  UNION ALL SELECT 'budget-500','lo','ງົບ 500'
  UNION ALL SELECT 'couple','th','มากับแฟน'
  UNION ALL SELECT 'couple','en','With Partner'
  UNION ALL SELECT 'couple','zh','情侣同行'
  UNION ALL SELECT 'couple','lo','ມາກັບແຟນ'
  UNION ALL SELECT 'family','th','มากับครอบครัว'
  UNION ALL SELECT 'family','en','With Family'
  UNION ALL SELECT 'family','zh','家庭出游'
  UNION ALL SELECT 'family','lo','ມາກັບຄອບຄົວ'
) t ON t.slug = s.slug;
