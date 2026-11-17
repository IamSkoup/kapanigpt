// Previous in-site currency pricing cannot represent the current RUB plans.
// Retired to prevent an old client from charging a mismatched amount.
export async function POST() {
  return Response.json({ error: "Оплата со счёта Капаней отключена. Открой новые тарифы FedyaGPT." }, { status: 410 });
}
