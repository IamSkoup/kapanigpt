import { getAccount, getUsage } from "@/lib/usage";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await getUsage(await getAccount(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (err) { return Response.json({ error: err instanceof Error ? err.message : "Сервис недоступен" }, { status: 401 }); }
}
