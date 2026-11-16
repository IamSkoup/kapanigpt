import { NextRequest } from "next/server";
import { getFirebaseUserId } from "@/lib/usage";
import { getKnowledgeStatus, getPersonalKnowledgeStatus, savePersonalKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";

// The private manuscript is never sent back to the browser. Every read/write
// uses the verified Firebase identity, not a client-supplied owner UID.
export async function GET(request: NextRequest) {
  try {
    const userId = await getFirebaseUserId(request);
    const [personal, shared] = await Promise.all([
      getPersonalKnowledgeStatus(userId), getKnowledgeStatus(),
    ]);
    return Response.json({
      personalAvailable: personal.available, personalCharacters: personal.characters,
      sharedAvailable: shared.available, sharedCharacters: shared.characters,
      publicAvailable: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось проверить базу знаний." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  let userId: string;
  try { userId = await getFirebaseUserId(request); }
  catch { return Response.json({ error: "Войди в Firebase-аккаунт." }, { status: 401 }); }
  try {
    const raw = await request.text();
    if (raw.length > 500000) return Response.json({ error: "Файл слишком большой." }, { status: 413 });
    const body = JSON.parse(raw) as { text?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length < 100 || body.text.length > 180000) {
      return Response.json({ error: "Текст канона должен содержать от 100 до 180000 символов." }, { status: 400 });
    }
    await savePersonalKnowledge(userId, body.text);
    const personal = await getPersonalKnowledgeStatus(userId);
    return Response.json({ personalAvailable: personal.available, personalCharacters: personal.characters,
      publicAvailable: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось сохранить приватный канон. Проверь соединение с базой." }, { status: 500 });
  }
}
