CREATE TABLE `ai_subscription_checkouts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`plan` text NOT NULL,
	`payer_uid` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`balance_after` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `ai_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
