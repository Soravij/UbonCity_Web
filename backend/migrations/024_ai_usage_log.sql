CREATE TABLE IF NOT EXISTS `ai_usage_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `task` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prompt_tokens` int unsigned DEFAULT NULL,
  `candidates_tokens` int unsigned DEFAULT NULL,
  `total_tokens` int unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_usage_log_actor_email` (`actor_email`),
  KEY `idx_ai_usage_log_user_id` (`user_id`),
  KEY `idx_ai_usage_log_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
