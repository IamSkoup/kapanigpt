-- Epoch times are bigint milliseconds, matching the former D1 records.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL, period TEXT NOT NULL, spent INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, period)
);
CREATE TABLE IF NOT EXISTS ai_image_tickets (
  ticket TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL, image_id TEXT
);
CREATE TABLE IF NOT EXISTS ai_subscriptions (
  user_id TEXT PRIMARY KEY, plan TEXT NOT NULL, expires_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_opening_promo_claims (
  user_id TEXT PRIMARY KEY, claimed_at BIGINT NOT NULL, starts_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_subscription_checkouts (
  user_id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, plan TEXT NOT NULL,
  payer_uid TEXT NOT NULL, status TEXT NOT NULL, created_at BIGINT NOT NULL,
  completed_at BIGINT, balance_after INTEGER, expires_at BIGINT
);
CREATE TABLE IF NOT EXISTS ai_user_preferences (
  user_id TEXT PRIMARY KEY, about TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '', tone TEXT NOT NULL DEFAULT 'balanced',
  history_enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_token_wallets (
  user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_token_checkouts (
  payment_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack TEXT NOT NULL,
  payer_uid TEXT NOT NULL, status TEXT NOT NULL, created_at BIGINT NOT NULL,
  completed_at BIGINT, bank_balance_after INTEGER, tokens_after INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_token_only_one_pending_per_user
  ON ai_token_checkouts (user_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS ai_site_settings (
  setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at BIGINT NOT NULL
);
