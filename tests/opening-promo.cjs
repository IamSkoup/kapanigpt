const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/promo/claim/route.ts'), 'utf8');
const usage = fs.readFileSync(path.join(root, 'lib/usage.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'drizzle/0005_big_sharon_carter.sql'), 'utf8');
const query = route.match(/d1\.prepare\(`([\s\S]*?)`\)/)?.[1];
assert.ok(query, 'claim route must use SQL-based, one-time grant');
assert.match(route, /getFirebaseUserId\(request\)/, 'claim requires a verified Firebase user');
assert.match(query, /INSERT OR IGNORE INTO ai_opening_promo_claims/, 'duplicate claims must be ignored in SQL');
assert.match(usage, /openingPromoClaims/, 'server usage and entitlements must read promo grants');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE ai_subscriptions (user_id TEXT PRIMARY KEY, plan TEXT, expires_at INTEGER, updated_at INTEGER)');
db.exec(migration);
const now = Date.parse('2026-11-09T12:00:00.000Z');
const week = 7 * 24 * 60 * 60 * 1000;
const claim = (uid, time) => db.prepare(query).run(uid, time, week, time, uid).changes;
const row = uid => db.prepare('SELECT * FROM ai_opening_promo_claims WHERE user_id = ?').get(uid);

assert.equal(claim('fb:new', now), 1, 'first claim is granted');
assert.equal(row('fb:new').starts_at, now, 'a free account receives the offer immediately');
assert.equal(row('fb:new').expires_at, now + week, 'offer lasts exactly seven days');
assert.equal(claim('fb:new', now + week + 10), 0, 'expired offers cannot be claimed again');
assert.equal(row('fb:new').expires_at, now + week, 'duplicate requests never extend the offer');

db.prepare('INSERT INTO ai_subscriptions VALUES (?, ?, ?, ?)').run('fb:paid', 'ultra', now + 2 * week, now);
assert.equal(claim('fb:paid', now), 1, 'a paid user can reserve the gift');
assert.equal(row('fb:paid').starts_at, now + 2 * week, 'the free Plus week starts after the paid plan');
assert.equal(row('fb:paid').expires_at, now + 3 * week, 'the paid plan is not shortened');
assert.equal(db.prepare('SELECT plan, expires_at FROM ai_subscriptions WHERE user_id = ?').get('fb:paid').plan, 'ultra');

assert.equal(claim('fb:other', now), 1, 'another Firebase UID has its own promotion');
console.log('OK: one-time opening promo, 7 days, no replay or paid-plan downgrade.');
