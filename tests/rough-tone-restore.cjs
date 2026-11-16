const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = p => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

test("rough tone is supported by preferences, API validation, and UI", () => {
  assert.match(load("lib/preferences-config.ts"), /"balanced" \| "direct" \| "creative" \| "rough"/);
  assert.match(load("lib/preferences.ts"), /row\.tone === "rough"/);
  assert.match(load("app/api/preferences/route.ts"), /"creative", "rough"/);
  assert.match(load("app/page.tsx"), /value="rough">Дерзкая, с матами/);
  const route = load("app/api/chat/route.ts");
  assert.match(route, /prefs\.tone === "rough"/);
  assert.match(route, /Допускаются естественные русские маты/);
  assert.match(route, /не переходи к угрозам, травле/);
});

test("private canon stays out of Git; restore uses parameterized SQL", () => {
  const restore = load("scripts/restore-private-knowledge.mjs");
  assert.match(restore, /process\.env\.DATABASE_URL/);
  assert.match(restore, /INSERT INTO ai_site_settings/);
  assert.match(restore, /\[text, Date\.now\(\)\]/);
  assert.match(restore, /ROLLBACK/);
  assert.match(load("app/page.tsx"), /Восстановить полный канон в моём аккаунте/);
  assert.match(load("app/api/knowledge/personal/route.ts"), /getFirebaseUserId\(request\)/);
  assert.match(load("app/api/knowledge/personal/route.ts"), /savePersonalKnowledge\(userId, body\.text\)/);
  assert.match(load("lib/knowledge.ts"), /createHash\("sha256"\)/);
});

test("rough is the default including legacy balanced, while explicit balanced stays available", () => {
  assert.match(load("lib/preferences-config.ts"), /tone: "rough", historyEnabled: true/);
  assert.match(load("lib/preferences.ts"), /row\.tone === "plain" \? "balanced"/);
  assert.match(load("lib/preferences.ts"), /input\.tone === "balanced" \? "plain"/);
});

test("public non-sensitive Kapani lore works before private restoration", () => {
  const lore = load("lib/kapani-public-lore.ts");
  const knowledge = load("lib/knowledge.ts");
  assert.match(lore, /Рыжик/);
  assert.match(lore, /Вова/);
  assert.match(lore, /Контролёр/);
  assert.match(knowledge, /const fallback = PUBLIC_KAPANI_LORE/);
  assert.match(knowledge, /personal\?\.available \? personal : shared!/);
  assert.match(knowledge, /getPersonalKnowledgeStatus\(userId: string\)/);
});
