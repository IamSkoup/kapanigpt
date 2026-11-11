export const runtime = "edge";

// Old generated files remain accessible through /api/image/file/:id so
// existing chat history is not broken, but no new generation is offered.
export async function POST() {
  return Response.json({ error: "Генерация изображений в KapaniGPT отключена." }, { status: 410 });
}

export async function GET() {
  return Response.json({ error: "Генерация изображений в KapaniGPT отключена." }, { status: 410 });
}
