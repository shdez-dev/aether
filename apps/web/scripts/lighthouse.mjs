import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

// Reuse Playwright's pinned browser and lifecycle, avoiding chrome-launcher's
// temporary-profile cleanup race on Windows.
const require = createRequire(import.meta.url);
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", resolve);
});
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const browser = await chromium.launch({
  args: [`--remote-debugging-port=${port}`],
});
try {
  const args = process.argv.slice(2);
  if (!args.some((arg) => arg.startsWith("--config")))
    args.push("--config=lighthouserc.cjs");
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("@lhci/cli/src/cli.js"),
        "autorun",
        ...args,
        `--collect.settings.port=${port}`,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await browser.close();
}
