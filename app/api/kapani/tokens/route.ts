import { getDb } from "@/db";
import { tokenCheckouts } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { TOKEN_PACKS, kapaniRpc, verifiedKapaniBank, type TokenPack } from "@/lib/kapani";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type BankReceipt = { success?: boolean; plan?: string; balance?: number; transactionId?: string };

export async function POST(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const data = await request.json() as { action?: "start" | "confirm"; pack?: TokenPack; purchaseId?: string };
    if (!data.pack || !Object.hasOwn(TOKEN_PACKS, data.pack)) throw new Error("Неизвестный пакет токенов.");
    const pack = TOKEN_PACKS[data.pack];
    const token = request.headers.get("x-kapani-token") || "";
    const bank = await verifiedKapaniBank(token);
    const db = getDb();

    if (data.action === "start") {
      const [pending] = await db.select().from(tokenCheckouts)
        .where(and(eq(tokenCheckouts.userId, userId), eq(tokenCheckouts.status, "pending"))).limit(1);
      if (pending) {
        if (pending.pack !== data.pack || pending.payerUid !== bank.payerUid)
          throw new Error("Сначала заверши предыдущую покупку с тем же банковским аккаунтом.");
        return Response.json({ purchaseId: pending.paymentId, pack: data.pack,
          tokens: pack.tokens, price: pack.price }, { headers: { "Cache-Control": "no-store" } });
      }
      if (bank.balance < pack.price) throw new Error("На банковском счёте Капаней недостаточно рублей.");
      const paymentId = crypto.randomUUID(); // Never accept a client-selected paid receipt ID.
      await db.insert(tokenCheckouts).values({ userId, paymentId, pack: data.pack,
        payerUid: bank.payerUid, status: "pending", createdAt: Date.now() }).onConflictDoNothing();
      const [saved] = await db.select().from(tokenCheckouts)
        .where(and(eq(tokenCheckouts.userId, userId), eq(tokenCheckouts.status, "pending"))).limit(1);
      if (!saved || saved.pack !== data.pack || saved.payerUid !== bank.payerUid)
        throw new Error("Другая покупка уже выполняется. Попробуй завершить её.");
      return Response.json({ purchaseId: saved.paymentId, pack: data.pack,
        tokens: pack.tokens, price: pack.price }, { headers: { "Cache-Control": "no-store" } });
    }

    if (data.action !== "confirm" || typeof data.purchaseId !== "string" || !UUID.test(data.purchaseId))
      throw new Error("Неверный номер покупки.");
    const paymentId = data.purchaseId.toLowerCase();
    const [checkout] = await db.select().from(tokenCheckouts)
      .where(and(eq(tokenCheckouts.userId, userId), eq(tokenCheckouts.paymentId, paymentId))).limit(1);
    if (!checkout || checkout.pack !== data.pack || checkout.payerUid !== bank.payerUid)
      throw new Error("Платёж не принадлежит этому аккаунту или пакету.");
    if (checkout.status === "completed") {
      return Response.json({ success: true, tokensAdded: pack.tokens,
        tokensBalance: checkout.tokensAfter, bankBalance: checkout.bankBalanceAfter },
      { headers: { "Cache-Control": "no-store" } });
    }
    if (checkout.status !== "pending") throw new Error("Покупка не может быть завершена.");

    // Reuse the bank's existing idempotent fixed-price charge. We disclose
    // the bank's subscription-plan label in the UI; no subscription is granted.
    const receipt = await kapaniRpc<BankReceipt>(token, "kp_ai_buy", { p_plan: pack.bankPlan, p_id: paymentId });
    if (receipt.success !== true || receipt.plan !== pack.bankPlan ||
        !Number.isSafeInteger(receipt.balance) ||
        (receipt.transactionId && receipt.transactionId.toLowerCase() !== paymentId))
      throw new Error("Банк не подтвердил покупку. Повтори с тем же номером.");

    const now = Date.now();
    // The row lock and all grants are in one Postgres transaction. An
    // interrupted confirmation can be retried with the same payment UUID.
    await db.transaction(async tx => {
      const current = await tx.execute(sql`SELECT payment_id, status FROM ai_token_checkouts
        WHERE payment_id=${paymentId} AND user_id=${userId} FOR UPDATE`);
      if (current.rows[0]?.status !== "pending") return;
      await tx.execute(sql`INSERT INTO ai_token_wallets (user_id, balance, updated_at)
        VALUES (${userId}, 0, ${now}) ON CONFLICT (user_id) DO NOTHING`);
      const credit = await tx.execute(sql`UPDATE ai_token_wallets
        SET balance=balance+${pack.tokens}, updated_at=${now}
        WHERE user_id=${userId} RETURNING balance`);
      const after = Number(credit.rows[0]?.balance);
      if (!Number.isSafeInteger(after)) throw new Error("Не удалось подтвердить баланс токенов.");
      await tx.execute(sql`UPDATE ai_token_checkouts SET status='completed',
        completed_at=${now}, bank_balance_after=${receipt.balance}, tokens_after=${after}
        WHERE payment_id=${paymentId} AND user_id=${userId} AND status='pending'`);
    });
    const [confirmed] = await db.select().from(tokenCheckouts)
      .where(eq(tokenCheckouts.paymentId, paymentId)).limit(1);
    if (!confirmed || confirmed.status !== "completed")
      throw new Error("Списание проведено, зачисление ещё подтверждается. Повтори покупку с тем же номером.");
    return Response.json({ success: true, tokensAdded: pack.tokens,
      tokensBalance: confirmed.tokensAfter, bankBalance: confirmed.bankBalanceAfter },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка покупки токенов." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
