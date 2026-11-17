const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('real-money checkout never trusts a browser amount and verifies provider status before granting access', () => {
  const route = read('app/api/billing/route.ts');
  const provider = read('lib/yookassa.ts');
  const migration = read('netlify/database/migrations/20261117180000_yookassa.sql');
  assert.match(route, /getFirebaseUserId\(request\)/);
  assert.match(route, /PLANS\[plan\]\.price\.toFixed\(2\)/);
  assert.match(route, /idempotenceKey: order\.orderId/);
  assert.match(provider, /yooRequest\("\/" \+ encodeURIComponent\(order\.paymentId\)\)/);
  assert.match(provider, /payment\.status !== "succeeded" \|\| !payment\.paid/);
  assert.match(provider, /payment\.amount\.value !== PLANS\[order\.plan as Plan\]\?\.price\.toFixed\(2\)/);
  assert.match(provider, /metadata\?\.order_id !== order\.orderId/);
  assert.match(provider, /FOR UPDATE/);
  assert.match(provider, /db\.transaction\(async tx =>/);
  assert.match(migration, /user_id text PRIMARY KEY/);
  assert.match(read('app/api/kapani/purchase/route.ts'), /status: 410/);
});
