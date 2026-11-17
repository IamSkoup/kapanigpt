CREATE TABLE IF NOT EXISTS ai_yoo_checkouts (
  user_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  payment_id text UNIQUE,
  plan text NOT NULL,
  status text NOT NULL,
  created_at bigint NOT NULL,
  completed_at bigint,
  expires_at bigint
);
