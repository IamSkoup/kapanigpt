import { NextRequest } from "next/server";
import { getFirebaseUserId } from "@/lib/usage";
import { getKnowledgeStatus, saveMasterPrompt } from "@/lib/knowledge";

export const runtime = "nodejs";

function ownerAllowed(firebaseUserId: string) {
  // Configuration is only on the server; the client cannot make itself owner.
  const ownerUid = process.env.KAPANIGPT_OWNER_UID?.trim();
  return !!ownerUid && firebaseUserId === "fb:" + ownerUid;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getFirebaseUserId(request);
    const status = await getKnowledgeStatus();
    // Only return metadata. The private prompt is never exposed by this API.
    return Response.json({ ...status, canEdit: ownerAllowed(userId) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось проверить состояние закрытой базы знаний." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  let userId: string;
  try { userId = await getFirebaseUserId(request); }
  catch { return Response.json({ error: "Войди в аккаунт." }, { status: 401 }); }
  if (!ownerAllowed(userId)) {
    return Response.json({ error: "Изменение общей базы разрешено только владельцу KapaniGPT." }, { status: 403 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 500000) return Response.json({ error: "Файл слишком большой." }, { status: 413 });
    const body = JSON.parse(raw) as { text?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length < 100 || body.text.length > 180000) {
      return Response.json({ error: "Для базы нужен файл от 100 до 180000 символов." }, { status: 400 });
    }
    await saveMasterPrompt(body.text);
    return Response.json({ ...await getKnowledgeStatus(), canEdit: true },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось сохранить закрытую базу знаний." }, { status: 500 });
  }
}
