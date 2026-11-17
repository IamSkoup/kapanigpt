import { getDb } from "@/db";
import { yooCheckouts } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { PLANS, type Plan } from "@/lib/kapani";
import { getFirebaseUserId } from "@/lib/usage";
import { settleCheckout, yooRequest } from "@/lib/yookassa";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const body = await request.json() as { plan?: Plan };
    const plan = body.plan;
    if (!plan || !["plus", "pro", "ultra", "max"].includes(plan))
      return Response.json({ error: "Выбери действующий тариф." }, { status: 400 });
    if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY)
      return Response.json({ error: "Оплата ещё не подключена. Администратору нужно указать ключи ЮKassa." }, { status: 503 });
    const origin = process.env.FEDYA_SITE_URL;
    if (!origin || !/^https:\/\/[^/]+$/.test(origin))
      throw new Error("Не указан проверенный адрес сайта для возврата после оплаты.");
    const db = getDb();
    let [order] = await db.select().from(yooCheckouts).where(eq(yooCheckouts.userId, userId)).limit(1);
    if (order?.status === "pending" && order.plan !== plan)
      throw new Error("Сначала заверши или отмени предыдущую покупку.");
    if (!order || order.status !== "pending") {
      const orderId = crypto.randomUUID(), now = Date.now();
      await db.insert(yooCheckouts).values({ userId, orderId, plan, status: "pending", createdAt: now })
        .onConflictDoNothing();
      if (order) await db.update(yooCheckouts).set({ orderId, plan, paymentId: null,
        status: "pending", createdAt: now, completedAt: null, expiresAt: null })
        .where(and(eq(yooCheckouts.userId, userId), ne(yooCheckouts.status, "pending")));
      [order] = await db.select().from(yooCheckouts).where(eq(yooCheckouts.userId, userId)).limit(1);
    }
    if (order.plan !== plan) throw new Error("Другая покупка уже обрабатывается.");
    if (!order.paymentId && Date.now() - order.createdAt > 20 * 3600000)
      throw new Error("Ответ о прежнем платеже потерян. Напиши в поддержку для сверки, повторно списывать деньги нельзя.");
    // Same order ID means retries cannot charge twice after a network failure.
    const payment = order.paymentId
      ? await yooRequest("/" + encodeURIComponent(order.paymentId))
      : await yooRequest("", { method: "POST", idempotenceKey: order.orderId, body: JSON.stringify({
          amount: { value: PLANS[plan].price.toFixed(2), currency: "RUB" }, capture: true,
          confirmation: { type: "redirect", return_url: origin + "/?payment=return" },
          description: `${PLANS[plan].name} на месяц`,
          metadata: { order_id: order.orderId, user_id: userId, plan },
        }) });
    if (!order.paymentId) await db.update(yooCheckouts).set({ paymentId: payment.id })
      .where(eq(yooCheckouts.userId, userId));
    if (payment.status === "succeeded") {
      await settleCheckout(userId);
      return Response.json({ status: "completed" });
    }
    if (payment.status === "canceled") {
      await settleCheckout(userId);
      throw new Error("Этот платёж отменён. Попробуй оформить покупку заново.");
    }
    const url = payment.confirmation?.confirmation_url;
    if (!url || !/^https:\/\/([a-z0-9.-]+\.)?(yookassa\.ru|yoomoney\.ru)\//i.test(url))
      throw new Error("ЮKassa не прислала безопасную ссылку оплаты.");
    return Response.json({ status: "pending", url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка оплаты." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: Request) {
  try {
    const userId = await getFirebaseUserId(request);
    const result = await settleCheckout(userId);
    return Response.json({ ...result, configured: !!(process.env.YOOKASSA_SHOP_ID &&
      process.env.YOOKASSA_SECRET_KEY && process.env.FEDYA_SITE_URL) },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось проверить оплату." },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
