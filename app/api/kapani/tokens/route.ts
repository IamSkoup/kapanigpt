// Token packs were removed in favour of five-hour and weekly plan limits.
export async function POST() {
  return Response.json({ error: "Покупка токенов отключена. Открой тарифы FedyaGPT." }, { status: 410 });
}
