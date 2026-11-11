import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, kapaniEmail, verifiedKapaniBank } from "@/lib/kapani";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "nodejs";

type BankLogin = {
  access_token?: string;
  expires_in?: number;
  error_code?: string;
  msg?: string;
  error_description?: string;
};

const noStore = { "Cache-Control": "no-store" };

// The bank credentials must not go directly from a Russian visitor's browser
// to Supabase's Cloudflare endpoint. This endpoint is same-origin and requires
// an existing authenticated KapaniGPT account before forwarding credentials.
export async function POST(request: Request) {
  try {
    await getFirebaseUserId(request);
    const body = await request.json() as { login?: unknown; password?: unknown };
    if (typeof body.login !== "string" || typeof body.password !== "string" ||
        !body.login.trim() || !body.password || body.login.length > 254 || body.password.length > 1024) {
      return Response.json({ error: "Введи ник и пароль от «Капани»." }, { status: 400, headers: noStore });
    }

    const login = body.login.trim();
    const email = login.includes("@") ? login.toLowerCase() : await kapaniEmail(login);
    let upstream: Response;
    try {
      upstream = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLIC_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: body.password }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return Response.json({ error: "Не удалось связаться с банком Капаней. Повтори попытку чуть позже." },
        { status: 502, headers: noStore });
    }

    const data = await upstream.json().catch(() => ({})) as BankLogin;
    if (!upstream.ok || !data.access_token) {
      const error = data.error_code === "invalid_credentials" || upstream.status === 400
        ? "Неверный ник или пароль Капани."
        : data.error_code === "over_request_rate_limit" || upstream.status === 429
          ? "Слишком много попыток входа. Подожди и попробуй ещё раз."
          : data.error_description || data.msg || "Банк Капаней отклонил вход.";
      return Response.json({ error }, { status: upstream.status === 429 ? 429 : 401, headers: noStore });
    }

    const bank = await verifiedKapaniBank(data.access_token);
    return Response.json({ nickname: bank.nickname, balance: bank.balance,
      accessToken: data.access_token, expiresIn: data.expires_in || 3600 },
      { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось проверить счёт Капаней." },
      { status: 401, headers: noStore });
  }
}
