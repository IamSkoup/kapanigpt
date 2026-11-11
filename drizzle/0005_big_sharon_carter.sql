CREATE TABLE `ai_opening_promo_claims` (
	`user_id` text PRIMARY KEY NOT NULL,
	`claimed_at` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
