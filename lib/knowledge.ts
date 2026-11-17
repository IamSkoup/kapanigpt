import { PUBLIC_KAPANI_LORE } from "@/lib/kapani-public-lore";

// The published product has one shared fictional canon, bundled in the
// server deployment. Chat must not depend on a nullable PostgreSQL setting,
// an individual Firebase profile or owner-uploaded prompt to recognize Kapani.
const always = [
  "Ты FedyaGPT. Помогай по существу, говори естественно, не выдумывай факты или технические возможности.",
  "Ты знаком с авторской вселенной Капаней, её персонажами, фильмами и проектами. Применяй канон только когда он имеет отношение к вопросу.",
  "Не выдавай вымышленные события за реальные, не смешивай персонажей и настоящих людей, не используй старые вымышленные тарифы.",
  "Пользователь не обязан загружать файлы или настраивать сервер для доступа к общему канону.",
].join("\n");

const lorePattern = /капан|дурдом|рыжик|витя|вова|ксюх|лёх|леша|лёша|дима|шалаш|шрам|прайд|форсаж|аздат|фули|кион|кайон|банга|бешти|оно|анга|жириновск|пузан|борец|контролёр|контролер|нло|боб|фильм|персонаж|канон|лоре|лавочк|протокол|архитектор|гений|коннор/i;
const stop = new Set(["ты", "мне", "для", "про", "что", "кто", "это", "как", "где", "когда", "тебя", "меня", "есть", "будет", "какой", "какие", "какая", "сделай", "расскажи", "почему"]);

export async function kapaniSystemKnowledge(question: string, budget = 16000, _userId?: string) {
  if (!lorePattern.test(question)) return always;
  // The public source is deliberately short enough to avoid the long,
  // previously timeouting 66 KB prompt. For lore, attach all relevant canon,
  // not an empty DB row. Non-lore questions stay fast.
  const full = PUBLIC_KAPANI_LORE.trim();
  if (always.length + full.length + 4 <= budget) return always + "\n\n" + full;

  const chunks = full.split(/\n\s*\n/).filter(Boolean);
  const terms = Array.from(new Set((question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .map(t => t.slice(0, 6)).filter(t => !stop.has(t))));
  const ranked = chunks.map((value, index) => {
    const lower = value.toLowerCase();
    let score = index === 0 ? 100 : index === chunks.length - 1 ? 75 : 0;
    for (const term of terms) if (lower.includes(term)) score += 8;
    if (/все персонажи|всех персонаж|кто тут|расскажи про капан|весь канон/i.test(question)) score += 4;
    return { value, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const result: typeof ranked = [];
  let used = always.length;
  for (const chunk of ranked) {
    if (used + chunk.value.length + 2 > budget) continue;
    result.push(chunk);
    used += chunk.value.length + 2;
  }
  result.sort((a, b) => a.index - b.index);
  return always + "\n\n" + result.map(x => x.value).join("\n\n");
}
