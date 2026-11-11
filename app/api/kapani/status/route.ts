import { verifiedKapaniBank } from "@/lib/kapani";
import { getFirebaseUserId } from "@/lib/usage";

export const runtime = "nodejs";

// Kapani is only the payment account. Never return its access/refresh token or
// use its identity as the owner of KapaniGPT conversations or subscriptions.
export async function POST(request: Request) {
  try {
    await getFirebaseUserId(request);
    const bank = await verifiedKapaniBank(request.headers.get("x-kapani-token") || "");
    return Response.json({ nickname: bank.nickname, balance: bank.balance },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Банк недоступен." },
      { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
