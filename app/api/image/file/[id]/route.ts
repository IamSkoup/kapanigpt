import { env } from "cloudflare:workers";
export const runtime = "edge";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  if (!env.BUCKET) return new Response("Storage unavailable", { status: 503 });
  const object = await env.BUCKET.get(`generated/${id}.webp`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/webp", "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" } });
}
