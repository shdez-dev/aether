import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import ts from "typescript";

const rootDirectory = resolve(import.meta.dirname, "..");

/**
 * Workspace imports must always follow this directed graph. Dependencies that
 * cross a boundary are only permitted when they are named below and backed by
 * an ADR. This keeps framework and infrastructure concerns out of the core.
 */
const packages = [
  { name: "@aether/domain", directory: "packages/domain", allows: [] },
  { name: "@aether/contracts", directory: "packages/contracts", allows: [] },
  {
    name: "@aether/application",
    directory: "packages/application",
    allows: ["@aether/domain", "@aether/contracts"],
  },
  { name: "@aether/auth", directory: "packages/auth", allows: [] },
  {
    name: "@aether/database",
    directory: "packages/database",
    allows: ["@aether/application", "@aether/domain"],
  },
  {
    name: "@aether/storage",
    directory: "packages/storage",
    allows: ["@aether/application"],
  },
  { name: "@aether/observability", directory: "packages/observability", allows: [] },
  {
    name: "@aether/testkit",
    directory: "packages/testkit",
    allows: ["@aether/application", "@aether/contracts", "@aether/domain"],
  },
  { name: "@aether/ui", directory: "packages/ui", allows: [] },
  {
    name: "@aether/server",
    directory: "apps/server",
    allows: [
      "@aether/application",
      "@aether/auth",
      "@aether/contracts",
      "@aether/database",
      "@aether/observability",
      "@aether/storage",
      "@aether/testkit",
    ],
  },
  {
    name: "@aether/worker",
    directory: "apps/worker",
    allows: [
      "@aether/application",
      "@aether/contracts",
      "@aether/database",
      "@aether/observability",
      "@aether/storage",
    ],
  },
  {
    name: "@aether/web",
    directory: "apps/web",
    allows: ["@aether/contracts", "@aether/ui"],
  },
];

const documentedExceptions = new Map([
  ["@aether/database:@aether/auth", "docs/adr/0007-puerto-de-sesiones-oidc-en-auth.md"],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        return [entryPath];
      }
      return [];
    }),
  );
  return files.flat();
}

function workspacePackage(specifier) {
  return specifier.startsWith("@aether/")
    ? specifier.split("/").slice(0, 2).join("/")
    : undefined;
}

const failures = [];
for (const currentPackage of packages) {
  const directory = resolve(rootDirectory, currentPackage.directory, "src");
  const files = await sourceFiles(directory);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const importedFile of imports) {
      const dependency = workspacePackage(importedFile.fileName);
      if (!dependency || dependency === currentPackage.name) continue;

      const exception = documentedExceptions.get(`${currentPackage.name}:${dependency}`);
      if (currentPackage.allows.includes(dependency) || exception) continue;

      failures.push(
        `${relative(rootDirectory, file)} imports ${dependency}, which is forbidden for ${currentPackage.name}.`,
      );
    }
  }
}

for (const [edge, adr] of documentedExceptions) {
  try {
    const adrPath = resolve(rootDirectory, adr);
    if (!(await stat(adrPath)).isFile()) {
      failures.push(`${edge} declares missing architectural exception ${adr}.`);
    }
  } catch {
    failures.push(`${edge} declares missing architectural exception ${adr}.`);
  }
}

if (failures.length > 0) {
  console.error("Architecture boundary violations:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(`Architecture boundaries valid across ${packages.length} workspace packages.`);
}
