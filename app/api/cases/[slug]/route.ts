import { getCase } from "@/src/lib/cases";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const c = await getCase(slug);
  return c ? Response.json(c) : Response.json({ error: "No such case." }, { status: 404 });
}
