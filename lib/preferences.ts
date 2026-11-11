import { getDb } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/lib/preferences-config";

export async function readPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await getDb().select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return row ? {
    about: row.about, instructions: row.instructions,
    tone: row.tone === "direct" || row.tone === "creative" ? row.tone : "balanced",
    historyEnabled: row.historyEnabled,
  } : DEFAULT_PREFERENCES;
}

export async function savePreferences(userId: string, input: UserPreferences) {
  await getDb().insert(userPreferences).values({ userId, ...input, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...input, updatedAt: Date.now() } });
}
