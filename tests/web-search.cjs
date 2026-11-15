const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const load = p => fs.readFileSync(path.join(root, p), "utf8");
const route = load("app/api/chat/route.ts");
const web = load("lib/web-search.ts");
const page = load("app/page.tsx");

test("server-side web lookup is automatic without a second model request", () => {
  assert.match(route, /const isWebQuestion =/);
  assert.match(route, /isWebQuestion \? searchWeb\(question, signal\)/);
  assert.doesNotMatch(route, /decideWebSearch\(/);
  assert.match(web, /process\.env\.BRAVE_SEARCH_API_KEY/);
  assert.match(web, /safesearch","strict"/);
  assert.match(web, /https:\/\/www\.bing\.com\/search/);
  assert.match(web, /https:\/\/api\.search\.brave\.com/);
  assert.match(web, /u\.protocol === "https:"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /m\.sources\.map/);
});
