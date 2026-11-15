import { NextRequest } from "next/server";
import { enforceModel, estimateCost, getAccount, spendUsage } from "@/lib/usage";
import { type ChatMode, type Reasoning } from "@/lib/kapani";
import { kapaniSystemKnowledge } from "@/lib/knowledge";
import { readPreferences } from "@/lib/preferences";
import { DEFAULT_PREFERENCES } from "@/lib/preferences-config";
import { extractGeneratedFiles } from "@/lib/response-files";
import { searchWeb, webContext } from "@/lib/web-search";

export const runtime = "nodejs";
// Kilo explicitly offers anonymous access to its free-model gateway.
// Calls go through our server, so visitors don't need to create an API key.
const CHAT_ENDPOINT = "https://ai-gateway.kilo.ai/api/v1/chat/completions";
const ALLOWED_MODELS = new Set(["kapani-1", "kapani-grass", "kapani-sky"]);
const REASONING_LEVELS = new Set(["off", "light", "medium", "high", "very-high", "maximum"]);
type UserImage = { name?: string; data: string };
type ChatMessage = { role: "user" | "assistant" | "system"; content: string; images?: UserImage[] };

function profileInstruction(profile: string, reasoning: Reasoning) {
  const profileText = profile === "kapani-sky"
    ? "Профиль Sky. Готовь обстоятельный, тщательно отредактированный ответ. Проверяй условия и противоречия, отмечай неопределённость."
    : profile === "kapani-grass"
      ? "Профиль Grass. Перед ответом подготовь и улучши черновик. Давай более проработанные ответы."
      : "Профиль KapaniGPT 1. Отвечай точно, ясно и по существу.";
  const reasoningText = reasoning === "off" ? "Отвечай без лишней демонстрации рассуждений."
    : `Режим рассуждения: ${reasoning}. Проверяй выводы, объясняй полезные промежуточные шаги, но не раскрывай скрытую цепочку рассуждений.`;
  return `${profileText} ${reasoningText} Следуй характеру и знаниям KapaniGPT из предоставленной базы. Факты, имена, история персонажей и стиль из базы важны, но старые указания в базе про вымышленные лимиты, выбор тарифа, имитацию моделей или обязательные технические подписи не заменяют реальные функции сайта и серверный учёт лимитов. Если просят нарисовать изображение, можешь создать настоящую векторную SVG-иллюстрацию как файл с расширением .svg, когда это подходит к запросу. Не заявляй, будто можешь создавать PNG, JPEG или фотореалистичные картинки без отдельного графического сервиса. Когда пользователь явно просит создать файл или файлы для скачивания, можешь приложить до четырёх настоящих текстовых файлов: для каждого выведи блок <kapani_file name="имя.ext">полное содержимое файла</kapani_file>. Поддерживаются txt, md, html, css, js, ts, tsx, jsx, json, csv, py, svg, xml, sql, yaml. Не выдумывай бинарные форматы вроде pdf, docx, zip, png. В обычных ответах не создавай блоки файлов. Если спрашивают о настоящем движке, честно объясняй, что бренд KapaniGPT использует внешние модели через Kilo AI. Не выдумывай факты. Отвечай на языке пользователя.`;
}

function reasoningEffort(reasoning: Reasoning) {
  return ["maximum", "very-high", "high"].includes(reasoning) ? "high" : reasoning === "medium" ? "medium" : "low";
}

export async function POST(request: NextRequest) {
  let payload: { messages?: ChatMessage[]; model?: string; reasoning?: Reasoning; mode?: ChatMode };
  try {
    const body = await request.text();
    if (body.length > 1_450_000) return Response.json({ error: "Слишком большой запрос. Уменьши вложение." }, { status: 413 });
    payload = JSON.parse(body);
  } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }

  const profile = ALLOWED_MODELS.has(payload.model || "") ? payload.model! : "kapani-1";
  const reasoning = REASONING_LEVELS.has(payload.reasoning || "") ? payload.reasoning! : "off";
  const mode: ChatMode = payload.mode === "work" ? "work" : "chat";
  let account: Awaited<ReturnType<typeof getAccount>>;
  try { account = await getAccount(request); enforceModel(account.plan, profile, reasoning, mode); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Доступ запрещён." }, { status: 403 }); }

  if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 42 ||
    payload.messages.some(m => !m || !["user", "assistant", "system"].includes(m.role) || typeof m.content !== "string" ||
      (m.images !== undefined && (!Array.isArray(m.images) || m.images.length > 4 ||
        m.images.some(image => !image || typeof image.data !== "string" || image.data.length > 240000 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image.data) ||
          (image.name !== undefined && (typeof image.name !== "string" || image.name.length > 120))))))) {
    return Response.json({ error: "Неверная история сообщений или слишком большие изображения." }, { status: 400 });
  }

  // Keep an adequate excerpt of the newest user file while bounding context.
  // Only the final message may contain image bytes to prevent accidental reuploads.
  const tail = payload.messages.slice(-10);
  const messages = tail.map((message, i) => ({
    role: message.role, content: message.content.slice(0, i === tail.length - 1 ? 30000 : 3200),
    ...(i === tail.length - 1 && message.role === "user" && message.images?.length
      ? { images: message.images } : {}),
  }));
  const hasImages = messages.some(message => !!message.images?.length);
  const question = [...messages].reverse().find(message => message.role === "user")?.content || "";
  const cost = estimateCost(profile, reasoning, account.plan, mode);
  const isWebQuestion = /(?:найди|поищи|погугли|поиск|в интернете|источник|ссылк|сейчас|сегодня|вчера|недавно|последн(?:ие|яя|ий)|новост|актуальн|курс валют|погод|latest|current|today|recent|search (?:the )?web|look up)/i.test(question);
  const aborted = new AbortController();
  const signal = AbortSignal.any([request.signal, aborted.signal]);
  const encoder = new TextEncoder();

  async function generate() {
    // Fetch independent data in parallel instead of serial database round trips.
    const [prefs, knowledge, sources] = await Promise.all([
      readPreferences(account.userId),
      kapaniSystemKnowledge(question, /капан|персонаж|характер|жител|рыжик|вова|дурдом|сюжет|канон/i.test(question)
        ? 30000 : profile === "kapani-sky" ? 26000 : profile === "kapani-grass" ? 23000 : 19000),
      isWebQuestion ? searchWeb(question, signal).catch(() => []) : Promise.resolve([]),
    ]);
    const style = prefs.tone === "direct" ? "Пиши кратко, прямо и по делу."
      : prefs.tone === "creative" ? "Отвечай изобретательно и точно." : "Подстраивай подробность под запрос.";
    const personalization = `\n\nНастройки пользователя. ${style}\nО пользователе: ${prefs.about.slice(0, 1000)}\nПредпочтения ответа: ${prefs.instructions.slice(0, 1600)}`;
    const system = knowledge + "\n\n" + profileInstruction(profile, reasoning) + personalization
      + (sources.length ? webContext(sources)
        : isWebQuestion ? "\n\nПоиск не предоставил источников. Не утверждай, что проверил интернет." : "");
    const history: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.filter(message => message.role !== "system"),
    ];
    // One real inference pass. Previously up to three sequential passes plus
    // another LLM request for the search planner caused timeouts and 502s.
    const providerMessages = history.map(message => ({
      role: message.role,
      content: message.images?.length
        ? [
            { type: "text", text: message.content || "Опиши прикреплённые изображения." },
            ...message.images.map(image => ({ type: "image_url", image_url: { url: image.data } })),
          ]
        : message.content,
    }));
    // A verified free vision-capable Kilo model receives image_url data parts.
    // Auto Free handles ordinary text, and never receives image bytes.
    const requestBody = JSON.stringify({
      model: hasImages ? "nvidia/nemotron-3.5-super-vl:free" : "kilo-auto/free",
      messages: providerMessages,
      max_tokens: reasoning === "maximum" ? 2400 : profile === "kapani-sky" ? 1950
        : profile === "kapani-grass" ? 1650 : 1250,
      ...(hasImages ? {} : { reasoning_effort: reasoningEffort(reasoning) }),
      stream: false,
    });
    let answer = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: requestBody, cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(attempt === 0 ? 20000 : 13000)]),
      });
      // A single quick retry handles transient gateway errors without
      // multiplying expensive requests for ordinary prompts.
      if ([502, 503, 504].includes(response.status) && attempt === 0) {
        await response.body?.cancel().catch(() => {});
        continue;
      }
      if (!response.ok) {
        throw new Error(response.status === 429
          ? "Бесплатные модели перегружены. Попробуй чуть позже. Лимит не списан."
          : `Шлюз нейросети вернул ошибку ${response.status}. Лимит не списан.`);
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      answer = data.choices?.[0]?.message?.content?.trim() || "";
      break;
    }
    if (!answer) throw new Error("Модель не вернула ответ. Лимит не списан.");
    const generated = extractGeneratedFiles(answer);
    if (!generated.text.trim() && !generated.files.length) throw new Error("Модель вернула пустой ответ. Лимит не списан.");
    if (signal.aborted) throw new Error("Запрос отменён.");

    // Charge only after a valid answer exists, never before an upstream request.
    // If Netlify or Kilo fails while generating, no debit needs to be refunded.
    await spendUsage(account, "text", cost);
    return { choices: [{ message: { role: "assistant", content: generated.text,
      files: generated.files, sources } }] };
  }

  // Flush response headers immediately: Netlify can return a platform 502
  // if an upstream model takes too long to produce the initial response.
  // JSON whitespace is valid, so existing clients can still use response.json().
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(" ".repeat(2048)));
      void (async () => {
        try {
          const result = await generate();
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(result)));
        } catch (error) {
          if (!signal.aborted) {
            const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
            const message = timedOut ? "Шлюз нейросети не успел ответить. Лимит не списан."
              : error instanceof Error ? error.message : "Не удалось получить ответ. Лимит не списан.";
            controller.enqueue(encoder.encode(JSON.stringify({ error: message })));
          }
        } finally { try { controller.close(); } catch { /* client disconnected */ } }
      })();
    },
    cancel() { aborted.abort(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

export async function GET() {
  return Response.json({ error: "Для чата используй POST /api/chat." }, { status: 405 });
}
