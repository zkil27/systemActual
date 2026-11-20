import { renderAppIcon } from "@/lib/brand/app-icon";
import { APP_ICONS, findAppIcon } from "@/lib/brand/icons";

export const dynamic = "force-static";

export function generateStaticParams() {
  return APP_ICONS.map((icon) => ({ file: icon.file }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const spec = findAppIcon(file);
  if (!spec) return new Response("Not found", { status: 404 });
  // Maskable icons keep the mark inside Android's 80% safe circle.
  return renderAppIcon(spec.size, {
    glyphScale: spec.purpose === "maskable" ? 0.42 : 0.56,
  });
}
