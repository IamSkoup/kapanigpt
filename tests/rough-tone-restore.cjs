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
  assert.match(load("app/page.tsx"), /Скопировать UID аккаунта Firebase/);
});
