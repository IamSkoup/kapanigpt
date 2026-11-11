const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/kapani/purchase/route.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'netlify/database/migrations/20261111130000_initial_schema.sql'), 'utf8');

test('subscription credit is atomic and retry-safe on Postgres', () => {
  assert.match(route, /getFirebaseUserId\(request\)/);
  assert.match(route, /verifiedKapaniBank\(token\)/);
  assert.match(route, /kapaniRpc<Receipt>\(token, "kp_ai_buy"/);
  assert.match(route, /db\.transaction\(async tx =>/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /current\.rows\[0\]\?\.status !== "pending"/);
  assert.match(route, /status='completed'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_subscription_checkouts \([\s\S]*?user_id TEXT PRIMARY KEY/);
});
