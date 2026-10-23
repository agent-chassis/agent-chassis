import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintPopulation, measureNamedPopulationContent } from "./runtime-inputs/population-identity.mjs";

export const SIDECAR_GENERATOR_IDENTITY_PROTOCOL_VERSION = "sidecar-generator-identity.v2";
const DEPENDENCIES = Object.freeze([
  "@bufbuild/protobuf", "@scip-code/scip", "@vscode/tree-sitter-wasm", "web-tree-sitter"
]);

const PRODUCERS = Object.freeze([
  "package.json",
  "src/lib/sidecar-status.mjs",
  "src/lib/sidecar-graph-schema.mjs",
  "src/lib/sidecar-graph-impact-artifact.mjs",
  "src/lib/sidecar-build.mjs",
  "src/lib/sidecar-graph-extractors.mjs",
  "src/lib/sidecar-graph-import-facts.mjs",
  "src/lib/sidecar-graph-import-resolution.mjs",
  "src/lib/sidecar-graph-contributions.mjs",
  "src/lib/sidecar-committed-diff.mjs",
  "src/lib/sidecar-incremental.mjs",
  "src/lib/sidecar-store.mjs",
  "src/lib/sidecar-store-schema.mjs",
  "src/lib/sidecar-store-queries.mjs",
  "src/lib/sidecar-store-publication.mjs",
  "src/lib/sidecar-store-codec.mjs",
  "src/lib/sidecar-store-lifecycle.mjs",
  "src/lib/sidecar-repository-identity.mjs",
  "src/lib/sidecar-paths.mjs",
  "src/lib/sidecar-schema.mjs",
  "src/lib/sidecar-scip-overlay.mjs",
  "src/lib/sidecar-scip-normalize.mjs",
  "src/lib/sidecar-scip-provision.mjs",
  "src/lib/sidecar-scip-projects.mjs",
  "src/lib/sidecar-scip-typescript-config.mjs",
  "src/lib/sidecar-scip-typescript-plan.mjs",
  "src/lib/sidecar-scip-typescript-runner.mjs",
  "src/lib/sidecar-scip-project-inputs.mjs",
  "src/lib/runtime-inputs/executable-lookup.mjs",
  "src/lib/runtime-inputs/population-identity.mjs",
  "src/lib/runtime-inputs/ecosystem-inputs-go.mjs",
  "src/lib/runtime-inputs/ecosystem-inputs-cargo.mjs",
  "src/lib/runtime-inputs/toolchain-observation.mjs",
  "src/lib/runtime-inputs/toolchain-descriptions.mjs",
  "src/lib/sidecar-scip-rust-projects.mjs",
  "src/lib/sidecar-language-descriptions.mjs",
  "src/lib/sidecar-graph-rust-imports.mjs",
  "src/lib/sidecar-committed-preparation.mjs",
  "src/lib/sidecar-ensure.mjs",
  "src/lib/sidecar-graph-impact.mjs",
  "src/lib/sidecar-joins.mjs",
  "src/lib/sidecar-graph-impact-shared.mjs",
  "src/lib/sidecar-graph-impact-overlay.mjs",
  "src/lib/sidecar-graph-impact-graph.mjs",
  "src/lib/sidecar-graph-impact-summary.mjs",
  "src/lib/sidecar-impact.mjs",
  "src/lib/sidecar-graph-impact-diff.mjs",
  "src/lib/sidecar-graph-impact-hints.mjs",
  "src/lib/sidecar-graph-impact-surfaces-actions.mjs",
  "src/lib/wiki.mjs",
  "src/lib/sidecar-committed-blobs.mjs"
]);

export class SidecarGeneratorIdentityRefusalError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarGeneratorIdentityRefusalError";
    this.code = code;
  }
}

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);

function input(name, work) {
  try { return work(); } catch (cause) {
    if (cause instanceof SidecarGeneratorIdentityRefusalError) throw cause;
    throw new SidecarGeneratorIdentityRefusalError(
      `graph-generator input ${name} is unreadable: ${cause.code ?? cause.name}: ${cause.message}`,
      { code: "generator_identity_input_unreadable", cause });
  }
}

function dependencyRoot(name, entry) {
  let directory = path.dirname(realpathSync(entry));
  for (;;) {
    const manifest = path.join(directory, "package.json");

    try {
      if (JSON.parse(readFileSync(manifest, "utf8")).name === name) return realpathSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`resolved entry ${entry} has no ${name} package root`);
    directory = parent;
  }
}

function population() {
  const entries = PRODUCERS.map(name => ({ name: `wiki-core/${name}`,
    path: input(`wiki-core/${name}`, () => realpathSync(path.join(packageRoot, name))) }));
  const roots = DEPENDENCIES.map(name => ({ name, path: input(name, () => dependencyRoot(name,
    name === "@vscode/tree-sitter-wasm" ? require.resolve(`${name}/package.json`)
      : name === "web-tree-sitter" ? require.resolve(name) : fileURLToPath(import.meta.resolve(name)))) }));
  const scip = roots.find(entry => entry.name === "@scip-code/scip");

  roots.push({ name: "@scip-code/scip/dependency/@bufbuild/protobuf",
    path: input("@scip-code/scip/dependency/@bufbuild/protobuf", () => dependencyRoot(
      "@bufbuild/protobuf", createRequire(path.join(scip.path, "package.json")).resolve("@bufbuild/protobuf"))) });
  function files(root, relative, ancestors) {
    const name = relative ? `${root.name}/${relative}` : root.name;
    input(name, () => {
      const physical = realpathSync(path.join(root.path, relative));
      const stat = lstatSync(physical);
      if (stat.isFile()) entries.push({ name, path: physical });
      else if (stat.isDirectory()) {
        if (ancestors.has(physical)) throw new Error(`cyclic generator input directory: ${physical}`);
        const next = new Set([...ancestors, physical]);
        for (const child of readdirSync(physical).sort()) {

          if (child !== "node_modules") files(root, relative ? `${relative}/${child}` : child, next);
        }
      } else throw new Error(`unsupported generator input type: ${physical}`);
    });
  }
  for (const root of roots) files(root, "", new Set());
  return entries;
}

function observe() {
  const entries = population();
  const fingerprint = input("installation population", () => fingerprintPopulation(entries.map(entry => entry.path)));
  return { entries, fingerprint };
}

const initial = (() => {
  try { return { observation: observe() }; } catch (error) { return { error }; }
})();

export function assertSidecarGeneratorInputsCurrent() {
  if (initial.error) throw initial.error;
  const current = observe();
  if (current.fingerprint !== initial.observation.fingerprint ||
      JSON.stringify(current.entries) !== JSON.stringify(initial.observation.entries)) {
    throw new SidecarGeneratorIdentityRefusalError(
      "graph-generator installation inputs changed after this process loaded; restart MCP or use a fresh generator process",
      { code: "generator_identity_input_changed" });
  }
  return initial.observation;
}

let measured = null;
let inFlight = null;

export async function computeSidecarGeneratorIdentity() {
  const observation = assertSidecarGeneratorInputsCurrent();
  if (measured) return measured;
  if (!inFlight) {
    inFlight = Promise.resolve().then(() => {
      const content = input("installation population", () => measureNamedPopulationContent(observation.entries));
      assertSidecarGeneratorInputsCurrent();
      const protocol_version = SIDECAR_GENERATOR_IDENTITY_PROTOCOL_VERSION;
      measured = Object.freeze({ protocol_version,
        generator_identity: `sha256:${createHash("sha256").update(JSON.stringify({
          protocol_version, content_digest: content.content_digest })).digest("hex")}` });
      return measured;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}
