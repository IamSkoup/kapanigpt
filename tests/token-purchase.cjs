const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'app/api/kapani/tokens/route.ts'), 'utf8');
const subscriptionRoute = fs.readFileSync(path.join(root, 'app/api/kapani/purchase/route.ts'), 'utf8');
const usage = fs.readFileSync(path.join(root, 'lib/usage.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'drizzle/0004_free_proemial_gods.sql'), 'utf8');

assert.match(route, /getFirebaseUserId\(request\)/, 'token owner is a verified Firebase account');
assert.match(route, /verifiedKapaniBank\(token\)/, 'payer is an authenticated bank account');
assert.match(route, /const paymentId = crypto\.randomUUID\(\)/, 'payment ID must be server generated');
assert.match(route, /kapaniRpc<BankReceipt>\(token, "kp_ai_buy"/, 'bank handles payment');
assert.match(subscriptionRoute, /tokenCheckouts/, 'token receipts cannot unlock subscriptions');
assert.match(usage, /balance>=\$\{amount\}/, 'token spending must be conditional and atomic');

const statements = [...route.matchAll(/d1\.prepare\(`([\s\S]*?)`\)/g)].map(x => x[1]);
assert.equal(statements.length, 2);
const db = new DatabaseSync(':memory:');
for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement);
const user = 'fb:example', receipt = 'ce97bff0-e083-484e-91ed-51a8a4e308e4';
db.prepare('INSERT INTO ai_token_checkouts(payment_id,user_id,pack,payer_uid,status,created_at) VALUES (?,?,?,?,?,?)')
  .run(receipt, user, 'small', 'supabase-payer', 'pending', 1000);
assert.throws(() => db.prepare('INSERT INTO ai_token_checkouts(payment_id,user_id,pack,payer_uid,status,created_at) VALUES (?,?,?,?,?,?)')
  .run('c3241bb0-ac38-41e4-a3be-09d9e31a8b7f', user, 'large', 'supabase-payer', 'pending', 1000), /UNIQUE/, 'cannot leave two pending purchases');

function creditOnce() {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO ai_token_wallets(user_id,balance,updated_at) VALUES (?, 0, ?)').run(user, 2000);
    db.prepare(statements[0]).run(120, 2000, user, user, receipt);
    db.prepare(statements[1]).run(2000, 1000, user, user, receipt);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
creditOnce();
assert.equal(db.prepare('SELECT balance FROM ai_token_wallets WHERE user_id=?').get(user).balance, 120);
assert.equal(db.prepare('SELECT status FROM ai_token_checkouts WHERE payment_id=?').get(receipt).status, 'completed');
creditOnce();
assert.equal(db.prepare('SELECT balance FROM ai_token_wallets WHERE user_id=?').get(user).balance, 120, 'retries must not credit twice');
assert.equal(db.prepare('UPDATE ai_token_wallets SET balance=balance-? WHERE user_id=? AND balance>=?').run(80, user, 80).changes, 1);
assert.equal(db.prepare('UPDATE ai_token_wallets SET balance=balance-? WHERE user_id=? AND balance>=?').run(80, user, 80).changes, 0, 'insufficient tokens cannot overdraw');
assert.equal(db.prepare('SELECT balance FROM ai_token_wallets WHERE user_id=?').get(user).balance, 40);

console.log('OK: verified token checkout, no double credit, no negative token balance.');
