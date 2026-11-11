import { NextRequest } from "next/server";
import { getFirebaseUserId } from "@/lib/usage";
import { readPreferences, savePreferences } from "@/lib/preferences";
import { type UserPreferences } from "@/lib/preferences-config";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    const userId = await getFirebaseUserId(request);
    return Response.json(await readPreferences(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить настройки." }, { status: 401 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await getFirebaseUserId(request);
    const data = await request.json() as Partial<UserPreferences>;
    if (typeof data.about !== "string" || data.about.length > 1500 ||
        typeof data.instructions !== "string" || data.instructions.length > 3000 ||
        !["balanced", "direct", "creative"].includes(data.tone || "") ||
        typeof data.historyEnabled !== "boolean") {
      return Response.json({ error: "Некорректные параметры персонализации." }, { status: 400 });
    }
    const preferences: UserPreferences = { about: data.about.trim(), instructions: data.instructions.trim(), tone: data.tone!, historyEnabled: data.historyEnabled };
    await savePreferences(userId, preferences);
    return Response.json(preferences);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить настройки." }, { status: 500 });
  }
}
