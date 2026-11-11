const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/promo/claim/route.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'netlify/database/migrations/20261111130000_initial_schema.sql'), 'utf8');

test('one-time promo is owned by a verified Firebase UID and expires after seven days', () => {
  assert.match(route, /getFirebaseUserId\(request\)/);
  assert.match(route, /ON CONFLICT \(user_id\) DO NOTHING RETURNING starts_at, expires_at/);
  assert.match(route, /GREATEST\(\$\{now\}, COALESCE/);
  assert.match(route, /const WEEK_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_opening_promo_claims \([\s\S]*?user_id TEXT PRIMARY KEY/);
});
