// Local-only private knowledge restoration. Never commit the input markdown.
// Usage: DATABASE_URL=... node scripts/restore-private-knowledge.mjs /path/to/KAPANIGPT_MASTER_PROMPT_v2.md
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const path = process.argv[2];
if (!path) {
  console.error("Передай путь к локальному файлу .md или .txt с оригинальным каноном Капаней.");
  process.exit(1);
}
if (!/\.(md|txt)$/i.test(path)) throw new Error("Поддерживаются только .md и .txt.");
const text = (await readFile(resolve(path), "utf8")).trim();
if (text.length < 100 || text.length > 180000) throw new Error("Неверный размер базы знаний (100–180000 символов).");
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Нужен DATABASE_URL от приватного PostgreSQL на Netlify. Не записывай его в файлы Git.");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`INSERT INTO ai_site_settings (setting_key, setting_value, updated_at)
    VALUES ('master_prompt', $1, $2)
    ON CONFLICT (setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value, updated_at = EXCLUDED.updated_at`, [text, Date.now()]);
  await client.query("COMMIT");
  console.log("Закрытая база Капаней восстановлена в PostgreSQL, символов:", text.length);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
