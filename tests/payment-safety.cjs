const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/api/kapani/purchase/route.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'drizzle/0002_superb_starjammers.sql'), 'utf8');
const statements = [...source.matchAll(/d1\.prepare\(`([\s\S]*?)`\)/g)].map(x => x[1]);
assert.equal(statements.length, 2, 'use the production entitlement/completion SQL');
assert.match(source, /getFirebaseUserId\(request\)/, 'recipient must be Firebase authenticated');
assert.match(source, /verifiedKapaniBank\(token\)/, 'payer must be verified separately');
assert.match(source, /kapaniRpc<Receipt>\(token, "kp_ai_buy"/, 'deduct funds only through Supabase RPC');
assert.match(source, /env\.DB|const d1 = env\.DB/, 'persist purchases server-side in D1');

const db = new DatabaseSync(':memory:');
for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement);
const uid = 'fb:example', payerUid = 'supabase-example';
const payId = '4eadb0bc-81b6-4d34-a496-0f2b3565291f';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-31T12:00:00Z');

function grant(id, plan, time) {
  db.exec('BEGIN');
  try {
    db.prepare("INSERT OR IGNORE INTO ai_subscriptions (user_id, plan, expires_at, updated_at) VALUES (?, 'free', 0, 0)").run(uid);
    db.prepare(statements[0]).run(plan, plan, time, WEEK, time, WEEK, time, uid, uid, id);
    db.prepare(statements[1]).run(time, 410, uid, uid, id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

db.prepare('INSERT INTO ai_subscription_checkouts (user_id,payment_id,plan,payer_uid,status,created_at) VALUES (?,?,?,?,?,?)')
  .run(uid,payId,'plus',payerUid,'pending',now);
grant(payId, 'plus', now);
const first = db.prepare('SELECT * FROM ai_subscriptions WHERE user_id=?').get(uid);
assert.equal(first.plan, 'plus');
assert.equal(first.expires_at, now + WEEK, 'first purchase gives precisely 7 days');
assert.equal(db.prepare('SELECT status FROM ai_subscription_checkouts').get().status, 'completed');

grant(payId, 'plus', now + 10_000);
const repeated = db.prepare('SELECT expires_at FROM ai_subscriptions WHERE user_id=?').get(uid);
assert.equal(repeated.expires_at, first.expires_at, 'concurrent/repeated completion cannot credit twice');

const nextId = 'a16ce95d-cd1e-45d5-b6f1-1b713dd27c61';
db.prepare('UPDATE ai_subscription_checkouts SET payment_id=?, plan=?, status=? WHERE user_id=?')
  .run(nextId, 'plus', 'pending', uid);
grant(nextId, 'plus', now + 10_000);
assert.equal(db.prepare('SELECT expires_at FROM ai_subscriptions').get().expires_at, now + 2 * WEEK,
  'a new, independently paid renewal extends the active week once');

console.log('OK: Firebase-owned seven-day subscriptions, idempotent D1 grants and renewals.');
