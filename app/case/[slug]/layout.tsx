// The case page streams behind a loading skeleton, and a page that has started streaming can no longer answer
// 404. This layout sits above that boundary, so an unknown slug is a real 404 before anything is sent.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { caseExists } from "@/src/lib/cases";

export default async function CaseLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await caseExists(slug))) notFound();
  return children;
}
