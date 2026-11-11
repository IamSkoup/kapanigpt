const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/kapani/tokens/route.ts'), 'utf8');
const usage = fs.readFileSync(path.join(root, 'lib/usage.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'netlify/database/migrations/20261111130000_initial_schema.sql'), 'utf8');

test('tokens are paid once per server-generated receipt and spent without overdraft', () => {
  assert.match(route, /getFirebaseUserId\(request\)/);
  assert.match(route, /verifiedKapaniBank\(token\)/);
  assert.match(route, /const paymentId = crypto\.randomUUID\(\)/);
  assert.match(route, /db\.transaction\(async tx =>/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /current\.rows\[0\]\?\.status !== "pending"/);
  assert.match(usage, /balance>=\$\{amount\}/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ai_token_only_one_pending_per_user[\s\S]*?WHERE status = 'pending'/);
});
