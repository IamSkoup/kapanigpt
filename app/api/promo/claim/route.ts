import { env } from "cloudflare:workers";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "edge";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const d1 = env.DB;
    if (!d1) throw new Error("Хранилище подписок временно недоступно.");
    const now = Date.now();

    // INSERT OR IGNORE and the primary key make the free week a one-time,
    // atomic entitlement across devices and simultaneous requests. Active
    // subscriptions are never replaced or shortened by claiming the offer.
    const result = await d1.prepare(`
      INSERT OR IGNORE INTO ai_opening_promo_claims (user_id, claimed_at, starts_at, expires_at)
      SELECT ?, ?, starts_at, starts_at + ?
      FROM (SELECT max(?, coalesce((SELECT expires_at FROM ai_subscriptions
                                   WHERE user_id = ?), 0)) AS starts_at)
    `).bind(userId, now, WEEK_MS, now, userId).run();
    if (result.meta?.changes !== 1) {
      return Response.json({ error: "Ты уже забрал бесплатную неделю Kapani AI plus." },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const claim = await d1.prepare("SELECT starts_at, expires_at FROM ai_opening_promo_claims WHERE user_id = ?")
      .bind(userId).first<{ starts_at: number; expires_at: number }>();
    if (!claim) throw new Error("Не удалось подтвердить активацию акции.");
    return Response.json({ success: true, startsAt: new Date(claim.starts_at).toISOString(),
      expiresAt: new Date(claim.expires_at).toISOString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось активировать акцию." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
