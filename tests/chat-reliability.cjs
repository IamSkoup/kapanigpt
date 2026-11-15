const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const route = load("app/api/chat/route.ts");
const ui = load("app/page.tsx");
const css = load("app/globals.css");

test("failed upstream generations cannot spend usage quota", () => {
  const validated = route.indexOf("if (!generated.text.trim() && !generated.files.length)");
  const spend = route.indexOf('await spendUsage(account, "text", cost)');
  assert.ok(validated > 0 && spend > validated, "charge must follow validated answer");
  assert.doesNotMatch(route, /refundUsage|chargedFrom/);
  assert.match(route, /signal\.aborted/);
});

test("chat flushes JSON response early and surfaces late errors to UI", () => {
  assert.match(route, /new ReadableStream<Uint8Array>/);
  assert.match(route, /encoder\.encode\(" "\.repeat\(2048\)\)/);
  assert.match(route, /JSON\.stringify\(\{ error: message \}\)/);
  assert.match(ui, /if \(initial\.error\) throw new Error\(initial\.error\)/);
});

test("long Markdown labels share a wrapping content column on mobile", () => {
  assert.match(ui, /className="prose-bullet-content"/);
  assert.match(css, /grid-template-columns: max-content minmax\(0, 1fr\)/);
  assert.match(css, /\.prose-bullet-content \{ min-width: 0;/);
});
