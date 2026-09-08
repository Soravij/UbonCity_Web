-- 033_shortcuts.sql
-- Shortcuts with translations and place associations.

CREATE TABLE IF NOT EXISTS shortcuts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shortcut_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shortcut_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shortcut_id INT NOT NULL,
  lang VARCHAR(16) NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shortcut_lang (shortcut_id, lang),
  CONSTRAINT fk_shortcut_translations_shortcut FOREIGN KEY (shortcut_id)
    REFERENCES shortcuts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shortcut_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shortcut_id INT NOT NULL,
  place_id INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shortcut_place (shortcut_id, place_id),
  KEY idx_shortcut_places_order (shortcut_id, sort_order),
  CONSTRAINT fk_shortcut_places_shortcut FOREIGN KEY (shortcut_id)
    REFERENCES shortcuts(id) ON DELETE CASCADE,
  CONSTRAINT fk_shortcut_places_place FOREIGN KEY (place_id)
    REFERENCES places(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
