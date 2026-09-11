import { describe, expect, it } from "vitest";

import { ClamAvDocumentScanner } from "./clamav-scanner.js";

const withClamAv = process.env.RUN_CLAMAV_INTEGRATION === "1" ? it : it.skip;

describe("ClamAV integration", () => {
  withClamAv(
    "clasifica contenido limpio y la firma EICAR en el daemon aislado",
    async () => {
      const scanner = new ClamAvDocumentScanner({
        host: "127.0.0.1",
        port: 3310,
        timeoutMs: 30_000,
      });
      await expect(
        scanner.scan({
          content: Buffer.from("evidence without malware"),
          fileName: "clean.txt",
        }),
      ).resolves.toEqual({ clean: true, signature: null });
      await expect(
        scanner.scan({
          content: Buffer.from(
            "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
          ),
          fileName: "eicar.txt",
        }),
      ).resolves.toMatchObject({ clean: false });
    },
  );
});
