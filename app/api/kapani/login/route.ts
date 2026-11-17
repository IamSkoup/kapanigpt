export async function POST() {
  return Response.json({ error: "Вход в старый банк для FedyaGPT отключён." }, { status: 410 });
}
