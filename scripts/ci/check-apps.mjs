#!/usr/bin/env node
// Opt-in application CI: discovers actual package.json files under apps/* and services/*.
// No packages on docs-only dev => explicit SKIP. Once a package is created it must be tested.
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packages = [];
for (const parent of ["services", "apps"]) {
  const dir = join(root, parent);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const pkgDir = join(dir, name);
    if (statSync(pkgDir).isDirectory() && existsSync(join(pkgDir, "package.json"))) {
      packages.push(pkgDir);
    }
  }
}
if (!packages.length) {
  console.log("SKIP: No application packages found under services/* or apps/*; dev is documentation-only.");
  process.exit(0);
}
const required = ["lint", "typecheck", "test", "build"];
for (const dir of packages) {
  const name = relative(root, dir);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  for (const script of required) {
    if (!pkg.scripts?.[script]) {
      console.error(`ERROR: ${name}/package.json missing scripts.${script}`);
      process.exit(1);
    }
  }
  if (!existsSync(join(dir, "package-lock.json"))) {
    console.error(`ERROR: ${name} needs a committed package-lock.json for reproducible npm ci.`);
    process.exit(1);
  }
  console.log(`CHECKING ${name}`);
  const commands = [
    ["ci", "--no-fund"],
    ["run", "lint"],
    ["run", "typecheck"],
    ["run", "test"],
    ["run", "build"],
    ["audit", "--omit=dev", "--audit-level=high"],
  ];
  for (const args of commands) {
    console.log(`  npm ${args.join(" ")}`);
    const proc = spawnSync("npm", args, {
      cwd: dir, stdio: "inherit", env: { ...process.env, CI: "true" }, timeout: 180_000,
    });
    if (proc.error || proc.status !== 0) {
      console.error(`FAILED: ${name} npm ${args.join(" ")}: ${proc.error?.message ?? proc.status}`);
      process.exit(1);
    }
  }
}
console.log(`PASS: ${packages.length} application packages checked.`);
