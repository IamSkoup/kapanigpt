import { getDb } from "@/db";
import { subscriptions, yooCheckouts } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { PLANS, type Plan } from "@/lib/kapani";

type YooPayment = { id: string; status: string; paid: boolean; test?: boolean; amount: { value: string; currency: string };
  metadata?: { order_id?: string; user_id?: string; plan?: string }; confirmation?: { confirmation_url?: string } };

function credentials() {
  const shop = process.env.YOOKASSA_SHOP_ID, secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shop || !secret) throw new Error("Оплата пока не подключена. Нужны ключи магазина ЮKassa.");
  return "Basic " + btoa(shop + ":" + secret);
}

export async function yooRequest(path: string, init?: RequestInit & { idempotenceKey?: string }): Promise<YooPayment> {
  const { idempotenceKey, ...rest } = init || {};
  const response = await fetch("https://api.yookassa.ru/v3/payments" + path, {
    ...rest, headers: { Authorization: credentials(), "Content-Type": "application/json",
      ...(idempotenceKey ? { "Idempotence-Key": idempotenceKey } : {}) }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`ЮKassa ответила ошибкой ${response.status}. Повтори попытку позже.`);
  return await response.json() as YooPayment;
}

function addMonth(time: number) {
  const date = new Date(time), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

export async function settleCheckout(userId: string) {
  const db = getDb();
  const [order] = await db.select().from(yooCheckouts).where(eq(yooCheckouts.userId, userId)).limit(1);
  if (!order) return { status: "none" };
  if (order.status === "completed") return { status: "completed", plan: order.plan, expiresAt: order.expiresAt };
  if (order.status === "canceled") return { status: "canceled" };
  if (!order.paymentId) return { status: "pending", retry: true };
  const payment = await yooRequest("/" + encodeURIComponent(order.paymentId));
  if (payment.id !== order.paymentId || payment.metadata?.order_id !== order.orderId ||
      payment.metadata?.user_id !== userId || payment.metadata?.plan !== order.plan ||
      payment.amount?.currency !== "RUB" || payment.amount.value !== PLANS[order.plan as Plan]?.price.toFixed(2) || payment.test)
    throw new Error("Не удалось сверить платёж. Подписка не активирована.");
  if (payment.status === "canceled") {
    await db.update(yooCheckouts).set({ status: "canceled" }).where(eq(yooCheckouts.userId, userId));
    return { status: "canceled" };
  }
  if (payment.status !== "succeeded" || !payment.paid) return { status: "pending" };

  const expiresAt = await db.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT status, plan FROM ai_yoo_checkouts
      WHERE user_id=${userId} AND order_id=${order.orderId} FOR UPDATE`);
    if (locked.rows[0]?.status === "completed") {
      const [done] = await tx.select().from(yooCheckouts).where(eq(yooCheckouts.userId, userId));
      return done.expiresAt!;
    }
    if (locked.rows[0]?.status !== "pending" || locked.rows[0]?.plan !== order.plan)
      throw new Error("Состояние покупки изменилось. Обнови страницу.");
    const [current] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    const now = Date.now();
    const base = current?.plan === order.plan && current.expiresAt > now ? current.expiresAt : now;
    const expiry = addMonth(base);
    await tx.insert(subscriptions).values({ userId, plan: order.plan, expiresAt: expiry, updatedAt: now })
      .onConflictDoUpdate({ target: subscriptions.userId, set: { plan: order.plan, expiresAt: expiry, updatedAt: now } });
    await tx.update(yooCheckouts).set({ status: "completed", completedAt: now, expiresAt: expiry })
      .where(eq(yooCheckouts.userId, userId));
    return expiry;
  });
  return { status: "completed", plan: order.plan, expiresAt };
}
