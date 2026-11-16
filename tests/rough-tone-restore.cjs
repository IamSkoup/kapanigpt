const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = p => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

test("rough is the default for new and legacy accounts", () => {
  const config = load("lib/preferences-config.ts");
  const prefs = load("lib/preferences.ts");
  assert.match(config, /"rough"/);
  assert.match(config, /tone: "rough", historyEnabled: true/);
  assert.match(prefs, /row\.tone === "plain" \? "balanced"/);
  assert.match(prefs, /input\.tone === "balanced" \? "plain"/);
  assert.match(load("app/api/preferences/route.ts"), /"creative", "rough"/);
  assert.match(load("app/page.tsx"), /value="rough">Дерзкая, с матами/);
  const route = load("app/api/chat/route.ts");
  assert.match(route, /prefs\.tone === "rough"/);
  assert.match(route, /Допускаются естественные русские маты/);
  assert.match(route, /не переходи к угрозам, травле/);
});

test("owner knowledge is universal and does not ask the visitor for technical configuration", () => {
  const lore = load("lib/kapani-public-lore.ts");
  const knowledge = load("lib/knowledge.ts");
  const ui = load("app/page.tsx");
  assert.match(lore, /ПРАВИЛА ОТВЕТОВ/);
  assert.match(lore, /Боб/);
  assert.match(lore, /Контролёр/);
  assert.match(lore, /«Капанёвский форсаж 1»/);
  assert.match(knowledge, /PUBLIC_KAPANI_LORE\.trim\(\)/);
  assert.doesNotMatch(ui, /Firebase UID|KAPANIGPT_OWNER_UID|Восстановить полный канон|Обновить общую базу/);
  assert.doesNotMatch(knowledge, /getDb\(/);
  assert.ok(!fs.existsSync(path.resolve(__dirname, "..", "app/api/knowledge/personal/route.ts")));
});
