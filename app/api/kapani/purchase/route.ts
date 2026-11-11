import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { subscriptionCheckouts, subscriptions, tokenCheckouts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { PLANS, kapaniRpc, verifiedKapaniBank, type Plan } from "@/lib/kapani";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "edge";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Receipt = { success?: boolean; balance?: number; expiresAt?: string; transactionId?: string; plan?: string };

export async function POST(request: Request) {
  try {
    // Two different credentials are verified separately. The Firebase UID is
    // the sole owner of the entitlement; Supabase is just the source of funds.
    const userId = await getFirebaseUserId(request);
    const body = await request.json() as { plan?: Plan; purchaseId?: string };
    const plan = body.plan;
    const paymentId = String(body.purchaseId || "").toLowerCase();
    if (typeof plan !== "string" || plan === "free" || !Object.hasOwn(PLANS, plan) || !PAYMENT_ID.test(paymentId))
      throw new Error("Неверный тариф или номер покупки.");
    const token = request.headers.get("x-kapani-token") || "";
    const bank = await verifiedKapaniBank(token);
    const db = getDb();
    const d1 = env.DB;
    if (!d1) throw new Error("Хранилище подписок KapaniGPT временно недоступно.");
    const [tokenPurchase] = await db.select({ paymentId: tokenCheckouts.paymentId }).from(tokenCheckouts)
      .where(eq(tokenCheckouts.paymentId, paymentId)).limit(1);
    if (tokenPurchase) throw new Error("Этот номер уже относится к покупке токенов, повторное списание недопустимо.");
    const selectCheckout = async () => (await db.select().from(subscriptionCheckouts)
      .where(eq(subscriptionCheckouts.userId, userId)).limit(1))[0];

    let checkout = await selectCheckout();
    const now = Date.now();
    // Do not create a sticky pending checkout for an obviously unaffordable
    // new purchase. An existing pending UUID must still be retryable after a
    // successful debit whose response was lost (balance may now be lower).
    if ((!checkout || checkout.status === "completed" && checkout.paymentId !== paymentId) &&
        bank.balance < PLANS[plan].price)
      throw new Error("На счёте Капаней недостаточно рублей для этой подписки.");
    if (!checkout) {
      await db.insert(subscriptionCheckouts).values({ userId, paymentId, plan, payerUid: bank.payerUid,
        status: "pending", createdAt: now }).onConflictDoNothing();
      checkout = await selectCheckout();
    } else if (checkout.status === "completed" && checkout.paymentId !== paymentId) {
      // A new deliberate checkout may replace only a fully settled previous
      // checkout. A retry can never replace an unresolved payment identifier.
      await db.update(subscriptionCheckouts).set({ paymentId, plan, payerUid: bank.payerUid,
        status: "pending", createdAt: now, completedAt: null, balanceAfter: null, expiresAt: null })
        .where(and(eq(subscriptionCheckouts.userId, userId),
          eq(subscriptionCheckouts.paymentId, checkout.paymentId),
          eq(subscriptionCheckouts.status, "completed")));
      checkout = await selectCheckout();
    }

    if (!checkout || checkout.paymentId !== paymentId || checkout.plan !== plan || checkout.payerUid !== bank.payerUid)
      throw new Error("Есть незавершённая другая покупка. Повтори её с тем же аккаунтом Капани.");

    if (checkout.status === "completed") {
      return Response.json({ success: true, plan, balance: checkout.balanceAfter,
        expiresAt: checkout.expiresAt ? new Date(checkout.expiresAt).toISOString() : null,
        nickname: bank.nickname }, { headers: { "Cache-Control": "no-store" } });
    }

    // kp_ai_buy is a SECURITY DEFINER Supabase RPC that debits the actual
    // wallet atomically and returns the prior receipt for the same UUID.
    // Never take an amount from the browser, or edit wallet JSON on the client.
    const receipt = await kapaniRpc<Receipt>(token, "kp_ai_buy", { p_plan: plan, p_id: paymentId });
    if (receipt.success !== true || receipt.plan !== plan ||
        !Number.isSafeInteger(receipt.balance) || (receipt.transactionId && receipt.transactionId.toLowerCase() !== paymentId))
      throw new Error("Банк Капаней не подтвердил платёж. Повтори его с тем же номером.");

    const dbNow = Date.now();
    // D1 batch is transactional: simultaneous retries can credit the Firebase
    // entitlement only once. An interrupted request retains the pending UUID;
    // retries call the idempotent Supabase RPC and finish this grant safely.
    await d1.batch([
      d1.prepare("INSERT OR IGNORE INTO ai_subscriptions (user_id, plan, expires_at, updated_at) VALUES (?, 'free', 0, 0)").bind(userId),
      d1.prepare(`UPDATE ai_subscriptions
        SET plan = ?,
            expires_at = CASE WHEN plan = ? AND expires_at > ? THEN expires_at + ? ELSE ? + ? END,
            updated_at = ?
        WHERE user_id = ? AND EXISTS (
          SELECT 1 FROM ai_subscription_checkouts
          WHERE user_id = ? AND payment_id = ? AND status = 'pending')`)
        .bind(plan, plan, dbNow, WEEK_MS, dbNow, WEEK_MS, dbNow, userId, userId, paymentId),
      d1.prepare(`UPDATE ai_subscription_checkouts
        SET status = 'completed', completed_at = ?, balance_after = ?,
            expires_at = (SELECT expires_at FROM ai_subscriptions WHERE user_id = ?)
        WHERE user_id = ? AND payment_id = ? AND status = 'pending'`)
        .bind(dbNow, receipt.balance, userId, userId, paymentId),
    ]);

    const [finished] = await db.select().from(subscriptionCheckouts)
      .where(eq(subscriptionCheckouts.userId, userId)).limit(1);
    const [entitlement] = await db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId)).limit(1);
    if (finished?.paymentId !== paymentId || finished.status !== "completed" || !entitlement?.expiresAt)
      throw new Error("Платёж проведён, но подписка ещё не подтверждена. Повтори с тем же номером покупки.");
    return Response.json({ success: true, plan: entitlement.plan, balance: finished.balanceAfter,
      expiresAt: new Date(entitlement.expiresAt).toISOString(), nickname: bank.nickname },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка оплаты подписки." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
