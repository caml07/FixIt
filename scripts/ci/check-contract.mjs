#!/usr/bin/env node
// Fast structural checks; NOT a replacement for formal Redocly/OpenAPI validation.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const errors = [];
const file = process.env.FIXIT_OPENAPI_PATH ? resolve(process.env.FIXIT_OPENAPI_PATH) : resolve(root, "docs/openapi.json");
let api;
try {
  api = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error("OpenAPI cannot be parsed:", e.message);
  process.exit(1);
}
if (!/^3\.1\.\d+$/.test(api.openapi ?? "")) errors.push("Expected OpenAPI 3.1.x.");
if (!api.info?.title || !api.info?.version) errors.push("Missing info title/version.");
if (!api.paths || typeof api.paths !== "object" || !Object.keys(api.paths).length) errors.push("Missing paths.");
for (const name of ["schemas", "securitySchemes"]) {
  if (!api.components?.[name]) errors.push(`Missing components.${name}`);
}
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
let ops = 0;
for (const [path, actions] of Object.entries(api.paths ?? {})) {
  if (!path.startsWith("/")) errors.push(`Path doesn't start with /: ${path}`);
  for (const [method, operation] of Object.entries(actions)) {
    if (!methods.has(method)) continue;
    ops++;
    if (!operation.responses || !Object.keys(operation.responses).length) errors.push(`Missing responses: ${method.toUpperCase()} ${path}`);
  }
}
function inspect(item) {
  if (!item || typeof item !== "object") return;
  if (typeof item.$ref === "string" && item.$ref.startsWith("#/")) {
    const path = item.$ref.slice(2).split("/").map(x => x.replace(/~1/g, "/").replace(/~0/g, "~"));
    let cur = api;
    for (const key of path) cur = cur?.[key];
    if (cur === undefined) errors.push(`Broken internal OpenAPI ref: ${item.$ref}`);
  }
  for (const value of Object.values(item)) inspect(value);
}
inspect(api);
if (errors.length) {
  for (const error of errors) console.error("ERROR:", error);
  process.exit(1);
}
console.log(`PASS: OpenAPI ${api.openapi}, ${Object.keys(api.paths).length} paths, ${ops} operations; references structurally resolved.`);
console.log("NOTICE: Structural check only. Run Redocly lint and SQL/Prisma validation separately; team review and application tests are independent gates.");
