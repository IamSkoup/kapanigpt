const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const route = load("app/api/chat/route.ts");
const page = load("app/page.tsx");
const knowledge = load("lib/knowledge.ts");
const lore = load("lib/kapani-public-lore.ts");
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

test("file snippets are substantial, with truncation disclosed", () => {
  assert.match(page, /a\.text!\.slice\(0, 6000\)/);
  assert.match(page, /фрагмент из/);
  assert.match(route, /message\.content\.slice\(0, i === tail\.length - 1 \? 30000 : 3200\)/);
});

test("Kapani canon is a real bundled system instruction, without DB or upload dependency", () => {
  assert.match(knowledge, /import \{ PUBLIC_KAPANI_LORE \}/);
  assert.match(knowledge, /return always \+ "\\n\\n" \+ full/);
  assert.match(route, /kapaniSystemKnowledge\(question/);
  assert.match(lore, /Ты — FedyaGPT/);
  assert.match(lore, /Рыжик/);
  assert.match(lore, /Лёхин шалаш/);
  assert.match(lore, /ФУЛИ|Фули/);
  assert.doesNotMatch(knowledge, /getDb|siteSettings|readMasterPrompt|readPersonalPrompt/);
  assert.doesNotMatch(page, /knowledgeInfo|KAPANIGPT_OWNER_UID|importKnowledgeFile|knowledgeFileRef/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "app/api/knowledge/route.ts")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "app/api/knowledge/personal/route.ts")), false);
});

test("SVG illustrations are previewed while raster endpoint is truthful", () => {
  assert.match(page, /svg-preview/);
  assert.match(page, /encodeURIComponent\(file\.content\)/);
  assert.match(image, /PNG\/JPEG/);
  assert.match(image, /status: 503/);
});
