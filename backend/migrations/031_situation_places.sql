-- 031_situation_places.sql
-- Junction table linking situations to places.

CREATE TABLE IF NOT EXISTS situation_places (
  id INT AUTO_INCREMENT PRIMARY KEY,
  situation_id INT NOT NULL,
  place_id INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_situation_place (situation_id, place_id),
  INDEX idx_situation_places_order (situation_id, sort_order),
  CONSTRAINT fk_situation_places_situation
    FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE,
  CONSTRAINT fk_situation_places_place
    FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
