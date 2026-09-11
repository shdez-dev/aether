import { spawnSync } from "node:child_process";

const inRepository = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
});
if (inRepository.status === 0 && inRepository.stdout.trim() === "true")
  spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "inherit",
  });
