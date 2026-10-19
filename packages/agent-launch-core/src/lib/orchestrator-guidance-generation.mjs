import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL, TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE } from
  "@agent-chassis/wiki-core/src/lib/tool-discovery/gating.mjs";

const TIERS = [TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL, TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE];
const ROOT = "packages/agent-launch-core/data/role-guides/orchestrator";
export const ORCHESTRATOR_GUIDANCE_ARTIFACTS = Object.freeze([true, false].flatMap(publishControlledAcceptanceOptOut =>
  TIERS.flatMap((registeredTier, index) => ["guide", "authoring-vignette"].map(document => Object.freeze({
    registeredTier, document, publishControlledAcceptanceOptOut,
    path: `${ROOT}/${String(index + (publishControlledAcceptanceOptOut ? 1 : 3)).padStart(2, "0")}/${document}.md`
  })))));

function invalid(sourcePath, line, cause) {
  throw Object.assign(new Error(`${sourcePath}:${line}: ${cause}; correct the canonical template and regenerate`),
    { code: "orchestrator_guidance_template_invalid", sourcePath, line, cause });
}

export function parseOrchestratorGuidanceTemplate({ source, sourcePath }) {
  if (typeof source !== "string" || source.trim() === "") invalid(sourcePath, 1, "template is empty or not text");
  const rows = [];
  let tier = null;
  let optOutPublication = false;
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    const opening = /^<!-- tier:([^ ]+) -->$/u.exec(line);
    if (line === "<!-- publication:controlled-acceptance-opt-out -->") {
      if (optOutPublication) invalid(sourcePath, index + 1, "nested publication block");
      optOutPublication = true;
    } else if (line === "<!-- /publication -->") {
      if (!optOutPublication) invalid(sourcePath, index + 1, "unmatched publication marker");
      optOutPublication = false;
    } else if (opening) {
      if (!TIERS.includes(opening[1])) invalid(sourcePath, index + 1, "unknown tier block");
      if (tier !== null) invalid(sourcePath, index + 1, "nested tier block");
      tier = opening[1];
    } else if (line === "<!-- /tier -->") {
      if (tier === null) invalid(sourcePath, index + 1, "unmatched closing tier marker");
      tier = null;
    } else {
      if (/<!--\s*\/?\s*tier\b/iu.test(line)) invalid(sourcePath, index + 1, "marker must occupy one complete line with exact syntax");
      if (/<!--\s*\/?\s*publication\b/iu.test(line)) invalid(sourcePath, index + 1, "publication marker must occupy one complete line with exact syntax");
      rows.push(Object.freeze({ tier, optOutPublication, text: line }));
    }
  }
  if (tier !== null) invalid(sourcePath, lines.length, "unclosed tier block");
  if (optOutPublication) invalid(sourcePath, lines.length, "unclosed publication block");
  return Object.freeze(rows);
}

export function generateOrchestratorGuidance({ guideSource, vignetteSource }) {
  const sources = { guide: parseOrchestratorGuidanceTemplate({ source: guideSource, sourcePath: "docs/orchestrator-guide-source.md" }),
    "authoring-vignette": parseOrchestratorGuidanceTemplate({ source: vignetteSource, sourcePath: "docs/orchestrator-authoring-vignette-source.md" }) };
  const outputs = new Map();
  for (const artifact of ORCHESTRATOR_GUIDANCE_ARTIFACTS) {
    const text = sources[artifact.document].filter(row => (row.tier === null || row.tier === artifact.registeredTier) &&
      (!row.optOutPublication || artifact.publishControlledAcceptanceOptOut))
      .map(row => row.text).join("\n")
      .replaceAll("{{authoring_vignette_path}}", path.posix.join(path.posix.dirname(artifact.path), "authoring-vignette.md"))
      .replace(/\n*$/u, "") + "\n";
    if (text.trim() === "") invalid(artifact.document, 1, "selected document is empty");
    outputs.set(artifact.path, text);
  }
  return outputs;
}

export async function reconcileOrchestratorGuidance({ repoRoot, check = true }) {
  const [guideSource, vignetteSource] = await Promise.all([
    readFile(path.join(repoRoot, "docs/orchestrator-guide-source.md"), "utf8"),
    readFile(path.join(repoRoot, "docs/orchestrator-authoring-vignette-source.md"), "utf8")]);
  const outputs = generateOrchestratorGuidance({ guideSource, vignetteSource });
  const differences = [];
  for (const [relative, expected] of outputs) {
    let actual;
    try { actual = await readFile(path.join(repoRoot, relative), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (actual !== expected) differences.push({ path: relative, state: actual === undefined ? "missing" : "changed" });
  }
  async function population(relative) {
    let entries;
    try { entries = await readdir(path.join(repoRoot, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await population(child);
      else if (!outputs.has(child)) differences.push({ path: child, state: "extra" });
    }
  }
  await population(ROOT);
  if (differences.some(row => row.state === "extra") || check && differences.length > 0) {
    throw Object.assign(new Error(`Generated orchestrator guidance differs: ${JSON.stringify(differences)}; regenerate through the owning build`),
      { code: "orchestrator_guidance_output_mismatch", differences });
  }
  if (!check) for (const [relative, text] of outputs) {
    await mkdir(path.dirname(path.join(repoRoot, relative)), { recursive: true });
    await writeFile(path.join(repoRoot, relative), text);
  }
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await reconcileOrchestratorGuidance({ repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
    check: !process.argv.includes("--write") });
}
