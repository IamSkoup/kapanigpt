export const SUPABASE_URL = "https://npivvwwkdnbeqmjcwrke.supabase.co";
// This publishable browser key is public and can be found in the Kapani project's config.js.
export const SUPABASE_PUBLIC_KEY = "sb_publishable_1JhKuvlyy43Zehyr4Z-JZg_AIfMiAts";

export type Plan = "free" | "plus" | "pro" | "ultra" | "max" | "prime";
export type ChatMode = "chat" | "work";
export type Entitlements = { plan: Plan; balance: number | null; nickname: string | null; expiresAt: string | null };
export const PLANS: Record<Plan, { name: string; price: number; imageLimit: number; fiveHourBudget: number; weeklyBudget: number; unlock: number }> = {
  free: { name: "Бесплатно", price: 0, imageLimit: 1, fiveHourBudget: 35, weeklyBudget: 175, unlock: 0 },
  plus: { name: "Fedya AI plus", price: 19, imageLimit: 5, fiveHourBudget: 100, weeklyBudget: 560, unlock: 0 },
  pro: { name: "Fedya AI pro", price: 49, imageLimit: 10, fiveHourBudget: 120, weeklyBudget: 1050, unlock: 2 },
  ultra: { name: "Fedya AI ultra", price: 79, imageLimit: 15, fiveHourBudget: 420, weeklyBudget: 2940, unlock: 2 },
  max: { name: "Fedya AI max", price: 99, imageLimit: 40, fiveHourBudget: 1080, weeklyBudget: 7560, unlock: 2 },
  // Previously paid Prime subscriptions retain their access until expiration.
  prime: { name: "Fedya AI max", price: 99, imageLimit: 40, fiveHourBudget: 1080, weeklyBudget: 7560, unlock: 2 },
};
export const MODEL_CHOICES = [
  { id: "serval-1", name: "serval 1", detail: "Самая быстрая · простые задачи", tier: 0 },
  { id: "leopard-1", name: "leopard 1", detail: "Быстрая · умеренные задачи", tier: 1 },
  { id: "lion-1", name: "lion 1", detail: "Код и логика · тщательная проверка", tier: 2 },
] as const;
// Token packs use the bank's existing, fixed-price idempotent checkout plans.
// The bank receipt uses bankPlan's label; a pack does not grant a subscription.
export const TOKEN_PACKS = {
  small: { name: "Стартовый", tokens: 120, price: 499, bankPlan: "plus" },
  medium: { name: "Большой", tokens: 420, price: 1299, bankPlan: "ultra" },
  large: { name: "Максимальный", tokens: 1200, price: 2999, bankPlan: "prime" },
} as const;
export type TokenPack = keyof typeof TOKEN_PACKS;
export type Reasoning = "off" | "light" | "medium" | "high" | "very-high" | "maximum";
export const REASONING = [
  { id: "light", name: "Лёгкий" }, { id: "medium", name: "Средний" },
  { id: "high", name: "Высокий" }, { id: "very-high", name: "Очень высокий" },
  { id: "maximum", name: "Максимальный" },
] as const;

export async function kapaniEmail(nick: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nick.normalize("NFC")));
  return "u" + [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 48) + "@users.kapani.invalid";
}

export async function kapaniRpc<T>(token: string, procedure: string, params: object = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${procedure}`, { method: "POST", headers: {
    "apikey": SUPABASE_PUBLIC_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json",
  }, body: JSON.stringify(params), cache: "no-store" });
  const json = await res.json().catch(() => ({})) as { message?: string; error_description?: string };
  if (!res.ok) throw new Error(json.message || json.error_description || `Supabase ${res.status}`);
  return json as T;
}

export async function verifiedKapaniBank(token: string): Promise<{ payerUid: string; nickname: string; balance: number }> {
  if (!token) throw new Error("Сначала авторизуйся в банке Капаней.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error("Сессия банка Капаней закончилась. Войди заново.");
  const person = await response.json() as { id?: string };
  if (!person.id) throw new Error("Банк не подтвердил владельца счёта.");
  const status = await kapaniRpc<{ nickname?: string; balance?: number }>(token, "kp_ai_status");
  if (!status.nickname || !Number.isSafeInteger(status.balance) || status.balance! < 0)
    throw new Error("Не удалось получить подтверждённый баланс в Капанях.");
  return { payerUid: person.id, nickname: status.nickname, balance: status.balance! };
}
