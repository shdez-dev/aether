import type { MetadataRoute } from "next";
import { publicSite } from "../env";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/workspace", "/api/", "/auth/"],
    },
    sitemap: new URL("/sitemap.xml", publicSite.appUrl).href,
  };
}
