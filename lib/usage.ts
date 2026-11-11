import { getDb } from "@/db";
import { openingPromoClaims, subscriptions, usage, tokenWallets } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { MODEL_CHOICES, PLANS, type ChatMode, type Plan, type Reasoning } from "@/lib/kapani";

type FirebaseClaims = { aud: string; iss: string; sub: string; exp: number; iat: number; firebase?: { sign_in_provider?: string } };
type Account = { userId: string; plan: Plan; nickname: string | null; balance: number | null; expiresAt: string | null;
  promoClaimed: boolean; promoStartsAt: string | null; promoExpiresAt: string | null };

function decodeJwt(part: string) {
  const value = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")));
}

async function verifyFirebase(jwt: string): Promise<string> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Требуется авторизация Firebase.");
  const header = decodeJwt(parts[0]);
  const claims = decodeJwt(parts[1]) as FirebaseClaims;
  const now = Date.now() / 1000;
  if (header.alg !== "RS256" || claims.aud !== "kapanigpt" || claims.iss !== "https://securetoken.google.com/kapanigpt" ||
      !claims.sub || claims.exp <= now || claims.iat > now + 60) throw new Error("Сессия Firebase истекла.");
  if (!claims.firebase?.sign_in_provider || claims.firebase.sign_in_provider === "anonymous")
    throw new Error("Для KapaniGPT нужна регистрация или вход в аккаунт.");
  const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error("Не удалось подтвердить сессию Firebase.");
  const body = await res.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const publicKey = body.keys?.find(x => x.kid === header.kid);
  if (!publicKey) throw new Error("Неизвестный ключ авторизации Firebase.");
  const key = await crypto.subtle.importKey("jwk", publicKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
    Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[2].length / 4) * 4, "=")), c => c.charCodeAt(0)),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!verified) throw new Error("Неподлинная сессия Firebase.");
  return "fb:" + claims.sub;
}

export async function getFirebaseUserId(request: Request): Promise<string> {
  const token = request.headers.get("x-firebase-token");
  if (!token) throw new Error("Войди в аккаунт KapaniGPT, чтобы продолжить.");
  return verifyFirebase(token);
}

export async function getAccount(request: Request): Promise<Account> {
  const userId = await getFirebaseUserId(request);
  const database = getDb();
  const [[record], [promo]] = await Promise.all([
    database.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    database.select().from(openingPromoClaims).where(eq(openingPromoClaims.userId, userId)).limit(1),
  ]);
  const now = Date.now();
  const paidActive = !!record && record.expiresAt > now && record.plan in PLANS && record.plan !== "free";
  const promoActive = !!promo && promo.startsAt <= now && promo.expiresAt > now;
  const plan: Plan = paidActive ? record.plan as Plan : promoActive ? "plus" : "free";
  const expiry = paidActive ? record.expiresAt : promoActive ? promo.expiresAt : null;
  return { userId, plan, balance: null, nickname: null,
    expiresAt: expiry ? new Date(expiry).toISOString() : null,
    promoClaimed: !!promo,
    promoStartsAt: promo ? new Date(promo.startsAt).toISOString() : null,
    promoExpiresAt: promo ? new Date(promo.expiresAt).toISOString() : null };
}

const weekPeriod = () => "w:" + Math.floor((Date.now() + 3 * 86400000) / (7 * 86400000));
const fiveHourPeriod = () => "5h:" + Math.floor(Date.now() / (5 * 3600000));
const fiveHourReset = () => (Math.floor(Date.now() / (5 * 3600000)) + 1) * (5 * 3600000);
const dayPeriod = () => "d:" + new Date().toISOString().slice(0, 10);

async function readPeriod(userId: string, period: string): Promise<{ spent: number; images: number }> {
  const rows = await getDb().select().from(usage).where(and(eq(usage.userId, userId), eq(usage.period, period))).limit(1);
  return { spent: rows[0]?.spent || 0, images: rows[0]?.images || 0 };
}
export async function getUsage(account: Account) {
  const [week, five, day, [wallet]] = await Promise.all([
    readPeriod(account.userId, weekPeriod()), readPeriod(account.userId, fiveHourPeriod()),
    readPeriod(account.userId, dayPeriod()),
    getDb().select({ balance: tokenWallets.balance }).from(tokenWallets).where(eq(tokenWallets.userId, account.userId)).limit(1),
  ]);
  const plan = PLANS[account.plan];
  return { plan: account.plan, nickname: account.nickname, balance: account.balance, expiresAt: account.expiresAt,
    promoEligible: !account.promoClaimed, promoClaimed: account.promoClaimed,
    promoStartsAt: account.promoStartsAt, promoExpiresAt: account.promoExpiresAt,
    providerConfigured: true, // Kilo's anonymous free gateway needs no user key.
    remainingPercent: Math.max(0, Math.round((1 - week.spent / plan.weeklyBudget) * 100)),
    remainingFiveHourPercent: Math.max(0, Math.round((1 - five.spent / plan.fiveHourBudget) * 100)),
    fiveHourBudget: plan.fiveHourBudget, weeklyBudget: plan.weeklyBudget,
    tokensBalance: wallet?.balance || 0,
    fiveHourResetsAt: fiveHourReset(),
    imagesLeft: Math.max(0, plan.imageLimit - day.images), imagesMax: plan.imageLimit };
}

export function estimateCost(model: string, reasoning: Reasoning, plan: Plan, mode: ChatMode = "chat"): number {
  const tier = MODEL_CHOICES.find(m => m.id === model)?.tier || 0;
  // Chat is deliberately inexpensive; Work's model/reasoning passes cost more.
  if (mode === "chat") return reasoning === "high" ? 3 : reasoning === "medium" ? 2 : 1;
  const base = tier === 2 ? 6 : tier === 1 ? 3 : 2;
  if (reasoning === "off") return base;
  const factor: Record<Reasoning, number> = { off: 1, light: 1.3, medium: 1.8, high: 2.5, "very-high": 3.5, maximum: 5 };
  return Math.ceil(base * factor[reasoning]);
}

export function enforceModel(plan: Plan, model: string, reasoning: Reasoning, mode: ChatMode = "chat") {
  const requiredTier = MODEL_CHOICES.find(m => m.id === model)?.tier;
  if (requiredTier === undefined) throw new Error("Неизвестная модель KapaniGPT.");
  if (mode === "work") {
    if (plan === "free") throw new Error("Режим «Работа» доступен с подписки Kapani AI plus.");
    if (!["off", "light", "medium", "high", "very-high", "maximum"].includes(reasoning)) throw new Error("Неизвестный режим рассуждения.");
  } else {
    if (model !== "kapani-1") throw new Error("Выбор модели доступен только в режиме «Работа».");
    if (plan === "free" && !["off", "medium"].includes(reasoning)) throw new Error("На бесплатном тарифе рассуждение можно только включить или выключить.");
    if (plan !== "free" && !["off", "light", "medium", "high"].includes(reasoning)) throw new Error("Для обычного чата доступны три уровня рассуждений.");
  }
}

export type ChargeSource = "limit" | "tokens";
export async function spendUsage(account: Account, kind: "text" | "image", amount = 1): Promise<ChargeSource> {
  const plan = PLANS[account.plan];
  const database = getDb();
  if (kind === "image") {
    const period = dayPeriod();
    await database.insert(usage).values({ userId: account.userId, period, spent: 0, images: 0 }).onConflictDoNothing();
    const changed = await database.execute(sql`UPDATE ai_usage SET images=images+1 WHERE user_id=${account.userId} AND period=${period} AND images<${plan.imageLimit}`);
    if (changed.rowCount !== 1) throw new Error("Дневной лимит изображений исчерпан.");
    return "limit";
  }
  const week = weekPeriod(), five = fiveHourPeriod(), userId = account.userId;
  const weeklyBudget = plan.weeklyBudget, fiveHourBudget = plan.fiveHourBudget;
  await database.insert(usage).values([{ userId, period: week, spent: 0, images: 0 }, { userId, period: five, spent: 0, images: 0 }]).onConflictDoNothing();
  // Lock both counters in a fixed order. Unlike two independent UPDATEs,
  // a concurrent request cannot charge one period without the other.
  const charged = await database.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT period, spent FROM ai_usage
      WHERE user_id=${userId} AND period IN (${week},${five}) ORDER BY period FOR UPDATE`);
    const spent = new Map(locked.rows.map(row => [String(row.period), Number(row.spent)]));
    if (spent.size !== 2 || spent.get(week)! + amount > weeklyBudget || spent.get(five)! + amount > fiveHourBudget)
      return false;
    const changed = await tx.execute(sql`UPDATE ai_usage SET spent=spent+${amount}
      WHERE user_id=${userId} AND period IN (${week},${five})`);
    if (changed.rowCount !== 2) throw new Error("Не удалось записать расход лимита.");
    return true;
  });
  if (charged) return "limit";

  // After either shared limit is depleted, consume bought tokens atomically.
  const tokenCharge = await database.execute(sql`UPDATE ai_token_wallets SET balance=balance-${amount}, updated_at=${Date.now()}
    WHERE user_id=${userId} AND balance>=${amount}`);
  if (tokenCharge.rowCount === 1) return "tokens";
  const counts = await getUsage(account);
  throw new Error(counts.tokensBalance > 0
    ? `Общий лимит исчерпан, а токенов не хватает на этот запрос (нужно ${amount}). Пополни запас.`
    : "Общий лимит исчерпан. Купи токены или дождись обновления лимита.");
}

export async function refundUsage(account: Account, kind: "text" | "image", amount = 1, source: ChargeSource = "limit") {
  const database = getDb();
  if (kind === "text" && source === "tokens") await database.execute(sql`UPDATE ai_token_wallets SET balance=balance+${amount}, updated_at=${Date.now()} WHERE user_id=${account.userId}`);
  else if (kind === "text") await database.execute(sql`UPDATE ai_usage SET spent=GREATEST(0,spent-${amount}) WHERE user_id=${account.userId} AND period IN (${weekPeriod()},${fiveHourPeriod()})`);
  else await database.execute(sql`UPDATE ai_usage SET images=GREATEST(0,images-1) WHERE user_id=${account.userId} AND period=${dayPeriod()}`);
}
