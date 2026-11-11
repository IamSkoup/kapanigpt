CREATE TABLE `ai_image_tickets` (
	`ticket` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`image_id` text
);
