import { NextRequest } from "next/server";
import { enforceModel, estimateCost, getAccount, spendUsage } from "@/lib/usage";
import { type ChatMode, type Reasoning } from "@/lib/kapani";
import { kapaniSystemKnowledge } from "@/lib/knowledge";
import { readPreferences } from "@/lib/preferences";
import { extractGeneratedFiles } from "@/lib/response-files";
import { searchWeb, webContext } from "@/lib/web-search";

export const runtime = "nodejs";
// The upstream gateway is accessed only from the server.
const CHAT_ENDPOINT = "https://ai-gateway.kilo.ai/api/v1/chat/completions";
const ALLOWED_MODELS = new Set(["serval-1", "leopard-1", "lion-1"]);
const WORK_PROVIDER_MODELS: Record<string, string> = {
  "serval-1": "liquid/lfm-3-1.7b:free",
  "leopard-1": "baidu/ernie-5.5-flash-preview:free",
  "lion-1": "cohere/north-mini-code:free",
};
const REASONING_LEVELS = new Set(["off", "light", "medium", "high", "very-high", "maximum"]);
type UserImage = { name?: string; data: string };
type ChatMessage = { role: "user" | "assistant" | "system"; content: string; images?: UserImage[] };

function profileInstruction(profile: string, reasoning: Reasoning, canSendFiles: boolean, underlyingModel: string) {
  const profileText = profile === "lion-1"
    ? "Ты работаешь в профиле lion 1: приоритет — код, логика, проверка условий и крайних случаев; допускается более долгий анализ."
    : profile === "leopard-1"
      ? "Ты работаешь в профиле leopard 1: умеренные задачи, быстрый ответ с проверкой главных допущений."
      : "Ты работаешь в профиле serval 1: лёгкие задачи, самый короткий путь к ответу и минимальное время анализа.";
  const depth: Record<Reasoning, string> = { off: "без отдельного анализа", light: "короткая проверка", medium: "проверка основных шагов", high: "подробная проверка", "very-high": "расширенная проверка", maximum: "максимально тщательная проверка" };
  const reasoningText = reasoning === "off" ? "Сразу дай ответ."
    : `Глубина рассуждения: ${depth[reasoning]}. Перед основным ответом добавь блок <fedya_reason> с кратким понятным пользователю объяснением подхода, проверок и неопределённостей. Это краткое объяснение результата, не дословная запись скрытого внутреннего рассуждения. </fedya_reason>`;
  const files = canSendFiles ? 'Если пользователь просит файл для скачивания, можешь отправить до четырёх текстовых файлов блоками <kapani_file name="имя.ext">содержимое</kapani_file>. Доступны txt, md, html, css, js, ts, tsx, jsx, json, csv, py, svg, xml, sql, yaml. Для изображений доступен только SVG; не обещай бинарные форматы.' : "На этом тарифе отправка файлов в чате недоступна; ответь текстом.";
  return `Ты — FedyaGPT. ${profileText} ${reasoningText} Общайся прямо, с характером, без сюсюканья и искусственных вступлений. По умолчанию допустимы уместные маты и резкие формулировки, но не теряй содержание и подстраивайся под просьбу пользователя; в чувствительных ситуациях отвечай бережно. Следуй фактам из базы о Капанях, но устаревшие названия продукта и правила тарифов в ней не действуют. ${files} Если спрашивают о технической основе, честно сообщи, что ответы генерирует внешний провайдер; техническая основа текущего запроса — ${underlyingModel}. Для чата с автовыбором точная базовая модель может меняться. Не утверждай, будто профили являются отдельно обученными собственными моделями. Не выдумывай факты. Отвечай на языке пользователя.`;
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

  const profile = ALLOWED_MODELS.has(payload.model || "") ? payload.model! : "serval-1";
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
  const providerModel = mode === "work" ? WORK_PROVIDER_MODELS[profile] : "kilo-auto/free";

  async function generate() {
    // Fetch independent data in parallel instead of serial database round trips.
    const [prefs, knowledge, sources] = await Promise.all([
      readPreferences(account.userId),
      kapaniSystemKnowledge(question, /капан|персонаж|характер|жител|рыжик|вова|дурдом|сюжет|канон/i.test(question)
        ? 30000 : profile === "lion-1" ? 26000 : profile === "leopard-1" ? 23000 : 19000, account.userId),
      isWebQuestion ? searchWeb(question, signal).catch(() => []) : Promise.resolve([]),
    ]);
    const style = prefs.tone === "rough"
      ? "Манера общения: дерзкая, саркастичная, живая и разговорная. Допускаются естественные русские маты, включая крепкие, если это к месту: в шутках, перепалке, при раздражении абсурдом или прямой просьбе отвечать жёстко. Можешь остро поставить на место, не заискивай, не играй в вежливого робота и не заменяй ответ морализаторством. Если пользователь прямо затеял грубую шутливую перепалку или провоцирует такой тон, допустимо даже короткое «иди нахуй», но никогда не отвечай так вместо содержательной помощи на обычный вопрос. Но всегда помогай по существу, не матерись механически в каждой строке, не переходи к угрозам, травле и унижению уязвимых людей. На медицинские, тяжёлые, кризисные и другие чувствительные вопросы отвечай серьёзно и бережно. Если пользователь сам просит более спокойный тон, подстройся."
      : prefs.tone === "direct" ? "Пиши кратко, прямо и по делу."
      : prefs.tone === "creative" ? "Отвечай изобретательно и точно." : "Подстраивай подробность под запрос.";
    const personalization = `\n\nНастройки пользователя. ${style}\nО пользователе: ${prefs.about.slice(0, 1000)}\nПредпочтения ответа: ${prefs.instructions.slice(0, 1600)}`;
    const system = knowledge + "\n\n" + profileInstruction(profile, reasoning, account.plan !== "free",
      mode === "work" ? providerModel : "автоматически выбираемая сторонняя модель") + personalization
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
    const selectedModel = hasImages ? "nvidia/nemotron-3.5-super-vl:free" : providerModel;
    const requestBody = JSON.stringify({
      model: selectedModel,
      messages: providerMessages,
      max_tokens: reasoning === "maximum" ? 2400 : profile === "lion-1" ? 1950
        : profile === "leopard-1" ? 1650 : 1250,
      ...(hasImages ? {} : { reasoning_effort: reasoningEffort(reasoning) }),
      stream: false,
    });
    let answer = "", actualModel = selectedModel;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: requestBody, cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(attempt === 0 ? (profile === "lion-1" ? 27000 : profile === "leopard-1" ? 23000 : 18000) : 13000)]),
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
      const data = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string | null } }> };
      answer = data.choices?.[0]?.message?.content?.trim() || "";
      actualModel = data.model || selectedModel;
      break;
    }
    if (!answer) throw new Error("Модель не вернула ответ. Лимит не списан.");
    const reasonMatch = reasoning !== "off" ? answer.match(/<fedya_reason>([\s\S]{1,2400}?)<\/fedya_reason>/i) : null;
    const reasoningSummary = reasonMatch?.[1]?.trim().slice(0, 1800) || "";
    const cleanAnswer = answer.replace(/<fedya_reason>[\s\S]*?<\/fedya_reason>/gi, "").trim();
    const generated = extractGeneratedFiles(cleanAnswer);
    if (account.plan === "free") {
      if (generated.files.length && generated.text === "Готово, файлы прикреплены ниже.")
        generated.text = "Отправка файлов доступна с Plus. Могу показать содержимое в чате.";
      generated.files = [];
    }
    if (!generated.text.trim() && !generated.files.length) throw new Error("Модель вернула пустой ответ. Лимит не списан.");
    if (signal.aborted) throw new Error("Запрос отменён.");

    // Charge only after a valid answer exists, never before an upstream request.
    // If Netlify or Kilo fails while generating, no debit needs to be refunded.
    if (!(mode === "chat" && ["ultra", "max", "prime"].includes(account.plan)))
      await spendUsage(account, "text", cost);
    return { choices: [{ message: { role: "assistant", content: generated.text,
      files: generated.files, reasoningSummary, providerModel: actualModel,
      elapsedMs: Date.now() - startedAt, sources } }] };
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
