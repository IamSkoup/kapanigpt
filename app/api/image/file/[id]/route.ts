export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  // Existing R2 assets are private to the legacy deployment. No public
  // cross-domain authentication proxy is installed on the new host.
  return new Response("Legacy image storage unavailable", { status: 404 });
}
