import { spawnSync } from "node:child_process";

const scanArgs = ["protect", "--staged", "--redact", "--verbose"];
const binary = process.env.GITLEAKS_BIN ?? "gitleaks";
let result = spawnSync(binary, scanArgs, { stdio: "inherit" });

if (result.error?.code === "ENOENT") {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  const repository = root.stdout.trim();
  if (root.status !== 0 || !repository)
    throw new Error("Cannot resolve the Git repository for secret scanning");
  result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${repository}:/repo`,
      "-w",
      "/repo",
      "ghcr.io/gitleaks/gitleaks:v8.24.3",
      ...scanArgs,
    ],
    { stdio: "inherit" },
  );
}

if (result.error)
  throw new Error(
    "Gitleaks is required. Install it locally, set GITLEAKS_BIN, or run Docker Desktop.",
  );
process.exit(result.status ?? 1);
