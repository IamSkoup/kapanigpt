CREATE TABLE `ai_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`about` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT 'balanced' NOT NULL,
	`history_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
