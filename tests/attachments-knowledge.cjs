const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const route = load("app/api/chat/route.ts");
const page = load("app/page.tsx");
const knowledge = load("lib/knowledge.ts");
const status = load("app/api/knowledge/route.ts");
const image = load("app/api/image/route.ts");

test("photos reach a real vision model and are validated before the upstream call", () => {
  assert.match(route, /nvidia\/nemotron-3\.5-super-vl:free/);
  assert.match(route, /type: "image_url"/);
  assert.match(route, /message\.images/);
  assert.match(route, /image\.data\.length > 240000/);
  assert.match(route, /hasImages \? "nvidia/);
  assert.match(page, /images\.length \? \{ images \} : \{\}/);
  assert.doesNotMatch(page, /изображение, которое модель не видит/);
  assert.doesNotMatch(page, /не умеет смотреть изображения/);
});

test("file snippets are substantially larger, with truncation disclosed", () => {
  assert.match(page, /a\.text!\.slice\(0, 6000\)/);
  assert.match(page, /фрагмент из/);
  assert.match(route, /message\.content\.slice\(0, i === tail\.length - 1 \? 30000 : 3200\)/);
});

test("the owner private prompt stays server-side and unavailable rows are visible", () => {
  assert.match(knowledge, /available: !!setting\?\.value\?\.trim\(\)/);
  assert.match(knowledge, /chunkParagraph\(part\)/);
  assert.match(knowledge, /saveMasterPrompt\(value: string\)/);
  assert.match(status, /process\.env\.KAPANIGPT_OWNER_UID/);
  assert.match(status, /firebaseUserId === "fb:" \+ ownerUid/);
  assert.match(status, /!ownerAllowed\(userId\)/);
  assert.match(status, /getKnowledgeStatus\(\)/);
  assert.doesNotMatch(status, /Response\.json\(\{[^\n]*text/);
  assert.doesNotMatch(route, /readPreferences\(account\.userId\)\.catch/);
  assert.doesNotMatch(page, /if \(!cancelled\) setPreferences\(DEFAULT_PREFERENCES\)/);
});

test("SVG illustrations are previewed while raster endpoint is truthful", () => {
  assert.match(page, /svg-preview/);
  assert.match(page, /encodeURIComponent\(file\.content\)/);
  assert.match(image, /PNG\/JPEG/);
  assert.match(image, /status: 503/);
});
