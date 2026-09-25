import { publicSiteSchema } from "@aether/contracts";
import { publicProduct } from "@aether/config";

export const publicSite = publicSiteSchema.parse({
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
  demoEmail: publicProduct.demoEmail,
});
