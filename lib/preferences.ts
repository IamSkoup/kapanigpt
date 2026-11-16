import { getDb } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/lib/preferences-config";

export async function readPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return row ? {
    about: row.about, instructions: row.instructions,
    tone: row.tone === "plain" ? "balanced" : row.tone === "direct" || row.tone === "creative" || row.tone === "rough" ? row.tone : "rough",
    historyEnabled: row.historyEnabled,
  } : DEFAULT_PREFERENCES;
}

export async function savePreferences(userId: string, input: UserPreferences) {
  const stored = { ...input, tone: input.tone === "balanced" ? "plain" : input.tone, updatedAt: Date.now() };
  await getDb().insert(userPreferences).values({ userId, ...stored })
    .onConflictDoUpdate({ target: userPreferences.userId, set: stored });
}
