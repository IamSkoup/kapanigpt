import { getDb } from "@/db";
import { siteSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const fallback = `KapaniGPT — русскоязычный ИИ-помощник проекта Капани.

Отвечай ясно, честно и по существу. Не выдумывай факты, личную память или возможности продукта.`;

// The complete owner-supplied instructions are bundled server-side. Select
// relevant passages on each request so a free model isn't overwhelmed by
// the ~53K-character knowledge base in every single context window.
const stopWords = new Set(["это", "что", "как", "где", "когда", "если", "тебя", "меня", "про", "для", "были", "будет", "можно", "сделай", "расскажи", "какой", "какая", "какие", "самый", "просто", "очень", "почему", "the", "and", "with", "what", "about", "this"]);

export async function kapaniSystemKnowledge(question: string, budget = 22000) {
  const [setting] = await getDb().select({ value: siteSettings.value }).from(siteSettings)
    .where(eq(siteSettings.key, "master_prompt")).limit(1);
  const paragraphs = (setting?.value || fallback).trim().split(/\n\s*\n/g).map(part => part.trim()).filter(Boolean);
  const identity = paragraphs.slice(0, 5).join("\n\n");
  const terms = Array.from(new Set((question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
    .map(word => word.slice(0, Math.min(word.length, 6)))
    .filter(word => !stopWords.has(word)))).slice(0, 30);
  const candidates = paragraphs.slice(5).map((paragraph, i) => {
    const lower = paragraph.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score += 3;
      if (lower.slice(0, 130).includes(term)) score += 3;
    }
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
  return `Официальная база знаний и инструкция KapaniGPT. Источник — документ владельца; личные истории не считаются независимо проверенными фактами.\n\n${identity}\n\n${selected.map(item => item.paragraph).join("\n\n")}`;
}
