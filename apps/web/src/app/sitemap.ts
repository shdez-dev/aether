import type { MetadataRoute } from "next";
import { publicSite } from "../env";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/seguridad"].map((path) => ({
    url: new URL(path, publicSite.appUrl).href,
  }));
}
