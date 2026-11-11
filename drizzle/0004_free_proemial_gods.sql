CREATE TABLE `ai_token_checkouts` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pack` text NOT NULL,
	`payer_uid` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`bank_balance_after` integer,
	`tokens_after` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_token_only_one_pending_per_user` ON `ai_token_checkouts` (`user_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `ai_token_wallets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
