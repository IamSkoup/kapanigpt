export const runtime = "nodejs";

// A short, cached end-to-end probe. It checks actual inference, not just a 200
// from a provider's account endpoint, and exposes no credentials or prompts.
let cachedAt = 0;
let cached: { configured: boolean; online: boolean; text: boolean; image: boolean } | null = null;

export async function GET() {
  if (cached && Date.now() - cachedAt < 10 * 60_000)
    return Response.json(cached, { status: cached.online ? 200 : 503, headers: { "Cache-Control": "no-store" } });

  const textResult = await fetch("https://ai-gateway.kilo.ai/api/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kilo-auto/free", messages: [{ role: "user", content: "What is 2+2? Reply only number." }], max_tokens: 384 }),
    signal: AbortSignal.timeout(25000), cache: "no-store",
  }).catch(() => null);
  let text = false;
  if (textResult?.ok) {
    const parsed = await textResult.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
    text = !!parsed.choices?.[0]?.message?.content;
  }
  cached = { configured: true, online: text, text, image: false };
  cachedAt = Date.now();
  return Response.json(cached, { status: cached.online ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
