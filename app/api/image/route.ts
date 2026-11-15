export const runtime = "nodejs";

// The former raster-image provider and private R2 bucket were not migrated.
// Do not pretend a PNG/JPEG image was generated. The chat can instead produce
// downloadable SVG illustrations; raster generation requires a real provider.
const error = { error: "Растровая генерация PNG/JPEG пока не подключена. В обычном чате можно попросить создать векторную SVG-иллюстрацию с просмотром и скачиванием." };

export async function POST() {
  return Response.json(error, { status: 503 });
}

export async function GET() {
  return Response.json(error, { status: 503 });
}
