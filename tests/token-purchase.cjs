const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('legacy token and bank checkout endpoints reject new payments', () => {
  for (const file of ['app/api/kapani/login/route.ts', 'app/api/kapani/status/route.ts',
    'app/api/kapani/purchase/route.ts', 'app/api/kapani/tokens/route.ts']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /status: 410/);
  }
});
