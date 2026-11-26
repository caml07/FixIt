#!/usr/bin/env node
// FixIt: dependency-free Markdown link checker; checks local file existence only.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const targets = ["README.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "docs/000.INDEX.md", "docs/002.Requirements.md", "docs/010.G1-Contracts.md", "docs/openapi.json", "docs/database/schema.prisma", "docs/database/migrations/20261126000100_ticket_intake_and_evidence/migration.sql", "docs/015.Hybrid-Development.md", "docs/016.CI-Team-Workflow.md", ".agents/skills/fixit-contract-first/SKILL.md", ".agents/skills/fixit-ci-handoff/SKILL.md", ".github/workflows/ci.yml"];
let errors = [];
for (const file of targets) {
  if (!existsSync(join(root, file))) errors.push(`Required file missing: ${file}`);
}

const markdown = [];
function walk(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (["node_modules", ".git", ".cache"].includes(entry)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".md")) markdown.push(full);
  }
}
for (const p of ["docs", ".agents/skills", ".github"]) walk(join(root, p));
for (const p of ["README.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md"]) {
  const file = join(root, p);
  if (existsSync(file)) markdown.push(file);
}

let links = 0;
for (const file of markdown) {
  const source = readFileSync(file, "utf8");
  // Handles ordinary Markdown links, ignores external URLs, pure anchors and literal code blocks.
  const text = source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1.*$/gm, "");
  const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']+["'])?\)/g;
  for (const match of text.matchAll(re)) {
    const link = match[1];
    if (/^(?:https?:|mailto:|data:|#)/i.test(link)) continue;
    links++;
    const rel = decodeURIComponent(link.split("#", 1)[0]);
    const dest = resolve(dirname(file), rel);
    if (!existsSync(dest)) {
      errors.push(`Broken link in ${relative(root, file)}: ${link}`);
    } else if (!dest.startsWith(root + "/") && dest !== root) {
      errors.push(`Link escapes repository: ${relative(root, file)} -> ${link}`);
    }
  }
}
if (errors.length) {
  for (const err of errors) console.error("ERROR:", err);
  process.exit(1);
}
console.log(`PASS: ${markdown.length} Markdown files, ${links} local file links; no missing targets.`);
