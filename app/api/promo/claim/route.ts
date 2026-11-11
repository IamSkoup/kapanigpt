import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "nodejs";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const now = Date.now();

    // ON CONFLICT and the primary key make the free week a one-time,
    // atomic entitlement across devices and simultaneous requests. Active
    // subscriptions are never replaced or shortened by claiming the offer.
    const result = await getDb().execute(sql`
      INSERT INTO ai_opening_promo_claims (user_id, claimed_at, starts_at, expires_at)
      SELECT ${userId}, ${now}, start_time, start_time + ${WEEK_MS}
      FROM (SELECT GREATEST(${now}, COALESCE((SELECT expires_at FROM ai_subscriptions
                                   WHERE user_id=${userId}), 0)) AS start_time) offer
      ON CONFLICT (user_id) DO NOTHING RETURNING starts_at, expires_at
    `);
    if (result.rowCount !== 1) {
      return Response.json({ error: "Ты уже забрал бесплатную неделю Kapani AI plus." },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const claim = result.rows[0];
    if (!claim) throw new Error("Не удалось подтвердить активацию акции.");
    return Response.json({ success: true, startsAt: new Date(Number(claim.starts_at)).toISOString(),
      expiresAt: new Date(Number(claim.expires_at)).toISOString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось активировать акцию." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
