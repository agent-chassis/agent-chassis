#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");

const ROOT_FILES = ["README.md", "LICENSE"];

const PUBLIC_DOCS = [
  "README-agents.md",
  "adoption.md",
  "agent-faq.md",
  "agent-launch-family-runtime-state.md",
  "agent-launch-filesystem-mcp-backends.md",
  "agent-launch-host-write-authority-sidecar.md",
  "agent-launch-operator-entrypoints.md",
  "agent-launch-policy-profiles.md",
  "agent-launch-quickstart.md",
  "agent-launch-run-provenance.md",
  "areas.md",
  "consumer-owned-docs.md",
  "enforcement-model.md",
  "env-reference.md",
  "index.md",
  "initiative-status.md",
  "local-package-install.md",
  "mcp-dispatch-runtime-contract.md",
  "mcp-integration.md",
  "mcp-operation-reference.md",
  "mcp-tool-registry-reference.md",
  "operating-model.md",
  "package-install.md",
  "quickstart.md",
  "tool-discovery-dispatch-runtime.md",
  "tool-discovery.md",
  "versioning.md",
  "wiki-contract-metadata.md",
  "work-record-ontology.md",
  "work-record-schema.md"
];

const FORBIDDEN_PATH_SEGMENTS = [
  "internal/",
  "wiki/",
  "tests/",
  ".agent-runs/",
  ".cache/",
  ".env"
];

const privateLiteralPattern = (parts) => new RegExp(parts.join(""), "i");

const SENSITIVE_PATTERNS = [
  { label: "private project slug", regex: privateLiteralPattern(["project", "-", "crescendo"]) },
  { label: "private publish secret", regex: privateLiteralPattern(["agent", "-chassis", "-npm", "-publish"]) },
  { label: "private release phase", regex: privateLiteralPattern(["Phase", " ", "1"]) },
  { label: "private release wave", regex: privateLiteralPattern(["first", "-", "wave"]) },
  { label: "retired private decision id", regex: privateLiteralPattern(["DEC", "-", "0004"]) },
  { label: "private-key-block", regex: /BEGIN (?:RSA |OPENSSH |EC |DSA |PRIVATE )?PRIVATE KEY/ },
  { label: "committed-auth-token", regex: /_authToken\s*=\s*(?!\$\{)[^\s]+/ },
  { label: "github-pat", regex: /github_pat_[A-Za-z0-9_]+/ },
  { label: "github-token", regex: /ghp_[A-Za-z0-9_]+/ }
];

function assertSafeRelativePath(relativePath) {
  const normalized = relativePath.replaceAll(path.sep, "/");
  if (path.isAbsolute(relativePath) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Refusing unsafe public-doc path: ${relativePath}`);
  }
  for (const forbidden of FORBIDDEN_PATH_SEGMENTS) {
    if (normalized === forbidden.slice(0, -1) || normalized.includes(forbidden)) {
      throw new Error(`Refusing forbidden public-doc path segment in ${relativePath}: ${forbidden}`);
    }
  }
}

async function assertCleanContent(sourceLabel, absolutePath) {
  const body = await readFile(absolutePath, "utf8");
  for (const { label, regex } of SENSITIVE_PATTERNS) {
    if (regex.test(body)) {
      throw new Error(`Refusing to package ${sourceLabel}: matched sensitive pattern ${label}`);
    }
  }
}

async function copyCheckedFile(sourceRelative, targetRelative) {
  assertSafeRelativePath(sourceRelative);
  assertSafeRelativePath(targetRelative);
  const source = path.join(REPO_ROOT, sourceRelative);
  const target = path.join(PACKAGE_ROOT, targetRelative);
  await assertCleanContent(sourceRelative, source);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function assertOnlyExpectedDocs() {
  const docsDir = path.join(PACKAGE_ROOT, "docs");
  const actual = (await readdir(docsDir)).sort();
  const expected = [...PUBLIC_DOCS].sort();
  const extra = actual.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !actual.includes(name));
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "Core public-doc bundle mismatch.",
        extra.length > 0 ? `Unexpected docs: ${extra.join(", ")}` : null,
        missing.length > 0 ? `Missing docs: ${missing.join(", ")}` : null
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

async function main() {
  await rm(path.join(PACKAGE_ROOT, "docs"), { recursive: true, force: true });

  for (const file of ROOT_FILES) {
    await copyCheckedFile(file, file);
  }
  for (const doc of PUBLIC_DOCS) {
    await copyCheckedFile(path.posix.join("docs", doc), path.posix.join("docs", doc));
  }

  await assertOnlyExpectedDocs();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
