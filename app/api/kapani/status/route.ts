export async function POST() {
  return Response.json({ error: "Старый банк для FedyaGPT отключён." }, { status: 410 });
}
