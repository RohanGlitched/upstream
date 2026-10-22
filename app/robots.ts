import type { MetadataRoute } from "next";

// Every page is public. The API routes stream investigations and sign memos; crawlers have no use for them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
  };
}
