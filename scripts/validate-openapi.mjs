import { readFile } from "node:fs/promises";

import { parseDocument } from "yaml";

const source = await readFile(
  "packages/contracts/openapi/aether.v1.yaml",
  "utf8",
);
const document = parseDocument(source, { uniqueKeys: true });
if (document.errors.length > 0)
  throw new Error(
    `OpenAPI YAML is invalid: ${document.errors.map(String).join("; ")}`,
  );
const spec = document.toJS();
if (
  !spec ||
  typeof spec !== "object" ||
  !String(spec.openapi).startsWith("3.1.")
)
  throw new Error("OpenAPI document must declare OpenAPI 3.1");
if (!spec.paths || typeof spec.paths !== "object")
  throw new Error("OpenAPI document must define paths");

const operationIds = new Set();
for (const [path, pathItem] of Object.entries(spec.paths)) {
  if (!path.startsWith("/")) throw new Error(`Invalid OpenAPI path: ${path}`);
  if (!pathItem || typeof pathItem !== "object") continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!/^(get|put|post|delete|patch|head|options|trace)$/.test(method))
      continue;
    if (!operation || typeof operation !== "object" || !operation.operationId)
      throw new Error(
        `Missing operationId for ${method.toUpperCase()} ${path}`,
      );
    if (operationIds.has(operation.operationId))
      throw new Error(`Duplicate operationId: ${operation.operationId}`);
    operationIds.add(operation.operationId);
  }
}

const resolvePointer = (pointer) => {
  const segments = pointer
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current = spec;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current))
      return undefined;
    current = current[segment];
  }
  return current;
};
const visit = (value) => {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
    if (resolvePointer(value.$ref) === undefined)
      throw new Error(`Unresolved local OpenAPI reference: ${value.$ref}`);
  }
  for (const child of Object.values(value)) visit(child);
};
visit(spec);
process.stdout.write(
  `OpenAPI valid: ${operationIds.size} operations and local references resolved.\n`,
);
