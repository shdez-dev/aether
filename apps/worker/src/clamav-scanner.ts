import { connect } from "node:net";

import type { DocumentMalwareScanner } from "@aether/application";

/** Cliente del protocolo INSTREAM de clamd; el antivirus vive fuera del proceso HTTP. */
export class ClamAvDocumentScanner implements DocumentMalwareScanner {
  constructor(
    private readonly config: { host: string; port: number; timeoutMs: number },
  ) {}
  async scan(input: {
    content: Uint8Array;
    fileName: string;
  }): Promise<{ clean: boolean; signature: string | null }> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.config.port, this.config.host);
      const timer = setTimeout(
        () => socket.destroy(new Error("ClamAV scan timed out")),
        this.config.timeoutMs,
      );
      const responses: Buffer[] = [];
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const length = Buffer.alloc(4);
        length.writeUInt32BE(input.content.byteLength);
        socket.write(length);
        socket.write(input.content);
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (chunk: Buffer) => responses.push(chunk));
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("end", () => {
        clearTimeout(timer);
        const response = Buffer.concat(responses)
          .toString("utf8")
          .replaceAll("\0", "")
          .trim();
        if (response.endsWith("OK"))
          return resolve({ clean: true, signature: null });
        const found = response.match(/: (.+) FOUND$/);
        if (found)
          return resolve({ clean: false, signature: found[1] ?? "unknown" });
        reject(
          new Error(`Unexpected ClamAV response: ${response.slice(0, 500)}`),
        );
      });
    });
  }
}
