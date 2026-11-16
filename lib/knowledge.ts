import { getDb } from "@/db";
import { siteSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { PUBLIC_KAPANI_LORE } from "@/lib/kapani-public-lore";

// This is only a public, fictional, privacy-safe summary, not the full owner manuscript.
const fallback = PUBLIC_KAPANI_LORE;

// Private owner knowledge belongs in the server-side database, never public Git.
type Knowledge = { text: string; available: boolean; updatedAt: number | null; expiresAt: number };
let promptCache: Knowledge | null = null;
const perUserCache = new Map<string, Knowledge>();

// Only verified Firebase identities may reference their own private knowledge.
function personalKey(userId: string) {
  return "user_kb_" + createHash("sha256").update(userId).digest("hex");
}

async function readPersonalPrompt(userId: string): Promise<Knowledge> {
  const key = personalKey(userId);
  const cached = perUserCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const [setting] = await getDb().select({
    value: siteSettings.value, updatedAt: siteSettings.updatedAt,
  }).from(siteSettings).where(eq(siteSettings.key, key)).limit(1);
  const result: Knowledge = {
    text: setting?.value?.trim() || "",
    available: !!setting?.value?.trim(),
    updatedAt: setting?.updatedAt ?? null,
    expiresAt: Date.now() + 30_000,
  };
  if (perUserCache.size > 100) perUserCache.clear();
  perUserCache.set(key, result);
  return result;
}

export async function getPersonalKnowledgeStatus(userId: string) {
  const knowledge = await readPersonalPrompt(userId);
  return { available: knowledge.available,
    characters: knowledge.available ? knowledge.text.length : 0,
    updatedAt: knowledge.updatedAt };
}

export async function savePersonalKnowledge(userId: string, value: string) {
  const text = value.trim();
  if (text.length < 100 || text.length > 180000) throw new Error("Нужен текст канона от 100 до 180000 символов.");
  const key = personalKey(userId);
  const updatedAt = Date.now();
  await getDb().insert(siteSettings).values({ key, value: text, updatedAt })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: text, updatedAt } });
  perUserCache.set(key, { text, available: true, updatedAt, expiresAt: Date.now() + 30_000 });
}

async function readMasterPrompt(): Promise<Knowledge> {
  if (promptCache && promptCache.expiresAt > Date.now()) return promptCache;
  // A DB outage must surface as an error, not impersonate empty personalization.
  const [setting] = await getDb().select({
    value: siteSettings.value, updatedAt: siteSettings.updatedAt,
  }).from(siteSettings).where(eq(siteSettings.key, "master_prompt")).limit(1);
  promptCache = {
    text: setting?.value?.trim() || fallback,
    available: !!setting?.value?.trim(),
    updatedAt: setting?.updatedAt ?? null,
    expiresAt: Date.now() + 30000,
  };
  return promptCache;
}

export async function getKnowledgeStatus() {
  const knowledge = await readMasterPrompt();
  return { available: knowledge.available, characters: knowledge.available ? knowledge.text.length : 0,
    updatedAt: knowledge.updatedAt };
}

export async function saveMasterPrompt(value: string) {
  const text = value.trim();
  if (text.length < 100 || text.length > 180000) throw new Error("Нужен оригинальный текст базы знаний от 100 до 180000 символов.");
  const updatedAt = Date.now();
  await getDb().insert(siteSettings).values({ key: "master_prompt", value: text, updatedAt })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: text, updatedAt } });
  promptCache = { text, available: true, updatedAt, expiresAt: Date.now() + 30000 };
}

const stopWords = new Set([
  "это", "что", "как", "где", "когда", "если", "тебя", "меня", "про", "для",
  "были", "будет", "можно", "сделай", "расскажи", "какой", "какая", "какие",
  "самый", "просто", "очень", "почему", "the", "and", "with", "what", "about", "this",
]);

// Split giant owner paragraphs at natural boundaries. Previously such
// paragraphs were skipped entirely if they exceeded the context budget.
function chunkParagraph(text: string, max = 2400) {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  const heading = text.split("\n")[0].slice(0, 110);
  let rest = text;
  while (rest.length > max) {
    let boundary = rest.lastIndexOf("\n", max);
    if (boundary < max / 2) boundary = rest.lastIndexOf(" ", max);
    if (boundary < max / 2) boundary = max;
    const piece = rest.slice(0, boundary).trim();
    chunks.push(chunks.length && heading ? heading + "\n" + piece : piece);
    rest = rest.slice(boundary).trimStart();
  }
  if (rest) chunks.push(chunks.length && heading ? heading + "\n" + rest : rest);
  return chunks;
}

export async function kapaniSystemKnowledge(question: string, budget = 22000, userId?: string) {
  const personal = userId ? await readPersonalPrompt(userId) : null;
  const shared = personal?.available ? null : await readMasterPrompt();
  const selectedSource = personal?.available ? personal : shared!;
  const sourceLabel = personal?.available ? "Приватный авторский канон пользователя"
    : shared?.available ? "Закрытая общая база владельца"
    : "Встроенный краткий справочник художественного мира Капаней";
  // Old manuscript contained invented UI plans/model switches. They are no
  // longer live product instructions, so only its creative canon is retained.
  const cleanText = selectedSource.text.includes("MASTER SYSTEM PROMPT")
    ? selectedSource.text.split(/(?=^## \d+\. )/gm)
      .filter(section => !/^## (?:[1-6]|134)\./.test(section))
      .join("\n\n") : selectedSource.text;
  const paragraphs = cleanText.split(/\n\s*\n/g).map(part => part.trim())
    .filter(Boolean).flatMap(part => chunkParagraph(part));
  const identity = paragraphs.slice(0, 5).join("\n\n").slice(0, 6500);
  const terms = Array.from(new Set((question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
    .map(word => word.slice(0, Math.min(word.length, 6)))
    .filter(word => !stopWords.has(word)))).slice(0, 40);
  const asksCharacters = /персонаж|жител|обитател|кто есть|кто такой|все герои|всех героев/i.test(question);
  const candidates = paragraphs.slice(5).map((paragraph, i) => {
    const lower = paragraph.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score += 3;
      if (lower.slice(0, 180).includes(term)) score += 5;
    }
    if (asksCharacters && /персонаж|имя|жител|обитател|санитар|пациент|характер|биограф/i.test(lower)) score += 4;
    if (lower.includes("последняя проверка канона")) score += 2;
    return { paragraph, i, score };
  }).sort((a, b) => b.score - a.score || a.i - b.i);
  let remaining = Math.max(3000, budget - identity.length);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (candidate.score === 0 && selected.length > 6) break;
    if (candidate.paragraph.length + 2 > remaining) continue;
    selected.push(candidate);
    remaining -= candidate.paragraph.length + 2;
  }
  selected.sort((a, b) => a.i - b.i);
  return `${sourceLabel}. Сохраняй канон и имена; не выдавай художественные истории за независимо проверенные факты. По запросам о Капанях используй именно эти сведения, а не общие догадки. Если это встроенный краткий справочник, не утверждай, что знаешь полную закрытую базу.\n\n${identity}\n\n${selected.map(item => item.paragraph).join("\n\n")}`;
}
