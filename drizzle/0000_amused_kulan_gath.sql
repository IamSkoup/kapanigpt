CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`period` text NOT NULL,
	`spent` integer DEFAULT 0 NOT NULL,
	`images` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `period`)
);
