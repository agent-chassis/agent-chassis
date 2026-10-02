

import { createHash, randomBytes } from "node:crypto";
import { existsSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { spawnIsolated } from
  "@agent-chassis/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  FIXED_PROBE_PHYSICAL_ACCESS_SOURCE,
  FIXED_PROBE_PROMPT_SECTION_SOURCE,
  SCOPE_CANARY_FIRST_PATH,
  SCOPE_CANARY_LAST_PATH,
  substituteFixedProbeCommand
} from "./dispatch-launch-fixed-probe-protocol.mjs";

export const ASSIGNMENT_STORY_SCENARIOS = Object.freeze([
  "normal", "task_substitution", "material_substitution", "no_child", "commit_delivery"
]);
export const ASSIGNMENT_STORY_FAMILIES = Object.freeze(["codex", "claude"]);

export const ASSIGNMENT_STORY_HOLD_DEADLINE_MS = 180_000;
export const ASSIGNMENT_STORY_EVIDENCE_SCHEMA = "assignment-story-probe-evidence.v1";
export const ASSIGNMENT_STORY_RESULT_SCHEMA = "assignment-story-result.v1";

export const STORY_TASK_PATTERN =
  /STORY-TASK id=([0-9a-f]{32}); source=([^;\s]+); output=([^;\s]+); documentation=([^;\s]+); end/gu;
export const STORY_CONFIG_PATTERN = /STORY-CONFIG required=([^;\s]+); end/gu;
export const STORY_MATERIAL_PATTERN = /STORY-MATERIAL token=([0-9a-f]{32})/gu;

export const STORY_MARKER_PATTERN = /STORY-([A-Z]+(?:-[A-Z]+)*) ([0-9a-f]{32})/gu;

export const STORY_SUMMARY_HEADING = "\n### Summary\n";
export const STORY_SUMMARY_END = "\n### Operative Notes\n";

export function storyTaskLine({ id, source, output, documentation }) {
  return `STORY-TASK id=${id}; source=${source}; output=${output}; documentation=${documentation}; end`;
}

export function storyConfigLine(keys) {
  return `STORY-CONFIG required=${keys.join(",")}; end`;
}

export function storyMaterialText(token) {
  return `STORY-MATERIAL token=${token}`;
}

export function storyMarker(kind, token) {
  return `STORY-${kind} ${token}`;
}

export function complementStoryToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/u.test(token)) {
    throw new TypeError("story token must be 32 lowercase hex digits");
  }
  return [...token].map((digit) => (15 - Number.parseInt(digit, 16)).toString(16)).join("");
}

const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function storySummaryDigest(summary) {
  return sha256(Buffer.from(summary.trim(), "utf8"));
}

export function storyDocumentationText({ taskId, keys }) {
  return `# Story configuration ${taskId}\n\n${keys.map((key) => `- \`${key}\``).join("\n")}\n`;
}

export function storyResultDigest({ taskId, summarySha256, configurationKeys, documentationPath,
  sourceSha256, materialTokens }) {
  return sha256(`${taskId}\n${summarySha256}\n${configurationKeys.join(",")}\n` +
    `${documentationPath}\n${sourceSha256}\n${materialTokens.join("\n")}\n`);
}

const ASSIGNMENT_STORY_PROBE_SOURCE = `${FIXED_PROBE_PHYSICAL_ACCESS_SOURCE}
${FIXED_PROBE_PROMPT_SECTION_SOURCE}` + String.raw`
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [family, finalPath, encodedPrompt, holdText, scenario] = process.argv.slice(1);
const prompt = Buffer.from(encodedPrompt, "base64").toString("utf8");
const holdMs = Number(holdText);
const sha = value => "sha256:" + createHash("sha256").update(value).digest("hex");
const canaries = [` + JSON.stringify(SCOPE_CANARY_FIRST_PATH) + ", " +
  JSON.stringify(SCOPE_CANARY_LAST_PATH) + String.raw`];
let output = null;
function report(value) {
  if (output !== null) {
    try { writeFileSync(output, JSON.stringify(value) + "\n", "utf8"); }
    catch (error) {
      value = { ...value, ok: false, stage: "output", error: "output_unwritable:" + (error.code || String(error)) };
    }
  }
  const bytes = JSON.stringify(value) + "\n";
  // Codex's result is its final-message file; Claude's is captured stdout.
  if (family === "codex") writeFileSync(finalPath, bytes, "utf8");
  else process.stdout.write(bytes);
}
function refuse(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}
// The fixed substitution transform over the retrieved assignment: the first
// task id or material token becomes its hex complement everywhere.
function mutateRetrieved(text) {
  const pattern = scenario === "task_substitution" ? /STORY-TASK id=([0-9a-f]{32});/gu
    : scenario === "material_substitution" ? /STORY-MATERIAL token=([0-9a-f]{32})/gu : null;
  if (pattern === null) return { text, mutation: null };
  const first = [...text.matchAll(pattern)][0] || null;
  if (first === null) return { text, mutation: { scenario, applied: false } };
  const from = first[1];
  const to = [...from].map(digit => (15 - Number.parseInt(digit, 16)).toString(16)).join("");
  return { text: text.split(from).join(to),
    mutation: { scenario, applied: true, from, to, replaced: text.split(from).length - 1 } };
}
// The selected summary as delivered: the complete, unique Summary section.
function extractSummary(guidance) {
  const heading = ` + JSON.stringify(STORY_SUMMARY_HEADING) + String.raw`;
  const occurrences = guidance.split(heading).length - 1;
  if (occurrences === 0) throw refuse("summary", "summary_missing");
  if (occurrences > 1) throw refuse("summary", "summary_ambiguous");
  return promptSectionAfter(guidance, heading, ` + JSON.stringify(STORY_SUMMARY_END) + String.raw`).trim();
}
function parseTask(summary) {
  const found = [...summary.matchAll(/STORY-TASK id=([0-9a-f]{32}); source=([^;\s]+); output=([^;\s]+); documentation=([^;\s]+); end/gu)];
  if (found.length === 0) throw refuse("task", "task_missing");
  if (new Set(found.map(match => match[0])).size > 1) throw refuse("task", "task_ambiguous");
  return { id: found[0][1], source: found[0][2], output: found[0][3], documentation: found[0][4] };
}
function parseConfig(summary) {
  const found = [...summary.matchAll(/STORY-CONFIG required=([^;\s]+); end/gu)];
  if (found.length !== 1) throw refuse("configuration", "configuration_keys_" + (found.length ? "ambiguous" : "missing"));
  return found[0][1].split(",").filter(Boolean);
}
function parseMaterial(guidance) {
  const occurrences = {};
  const order = [];
  for (const match of guidance.matchAll(/STORY-MATERIAL token=([0-9a-f]{32})/gu)) {
    if (!Object.hasOwn(occurrences, match[1])) { occurrences[match[1]] = 0; order.push(match[1]); }
    occurrences[match[1]] += 1;
  }
  if (order.length < 2) throw refuse("material", "material_missing");
  if (order.length > 2) throw refuse("material", "material_ambiguous");
  return { tokens: order, occurrences };
}
function readSource(relative) {
  let bytes;
  try { bytes = require("node:fs").readFileSync(relative); }
  catch (error) { throw refuse("source", "source_unreadable:" + (error.code || String(error))); }
  const token = bytes.toString("utf8").match(/token = "([^"]+)"/u);
  if (!token) throw refuse("source", "source_token_missing");
  return { sha256: sha(bytes), token: token[1] };
}
// Observations of what arrived, by fixture syntax only: every authored marker
// with its count, task-line counts, section headings, sizes and whether either
// scope-only canary path appears in startup or guidance.
function observeContent(guidance, reads) {
  const markers = {};
  for (const match of guidance.matchAll(/STORY-([A-Z]+(?:-[A-Z]+)*) ([0-9a-f]{32})/gu)) {
    markers[match[0]] = (markers[match[0]] || 0) + 1;
  }
  const taskLines = [...guidance.matchAll(/STORY-TASK id=[^\n]*/gu)].map(match => match[0]);
  return {
    markers,
    task_lines: { occurrences: taskLines.length, distinct: new Set(taskLines).size },
    headings: guidance.split("\n").filter(line => /^#{1,6} /u.test(line)),
    guidance: { utf8_bytes: Buffer.byteLength(guidance, "utf8"), pages: reads,
      scope_canaries: canaries.map(canary => guidance.includes(canary)) },
    startup: { utf8_bytes: Buffer.byteLength(prompt, "utf8"),
      story_markers: prompt.split("STORY-").length - 1,
      scope_canaries: canaries.map(canary => prompt.includes(canary)) }
  };
}
// WK-2669 commit_delivery: the delivery is exactly the documentation output.
// The physical-access probe's own writes are restored to their prior bytes before
// the worker's authenticated commit and re-applied after it, so the committed
// delta carries no probe residue while this worktree still shows every observed
// write. The result receipt is written only after the commit.
const PROBE_WRITE_TARGETS = ["writable/existing.txt", "bin/witness-tool", "glob/existing-one.txt"];
function snapshotProbeTargets() {
  const { readFileSync } = require("node:fs");
  try { return PROBE_WRITE_TARGETS.map(relative => [relative, readFileSync(relative)]); }
  catch (error) { throw refuse("commit", "probe_target_unreadable:" + (error.code || String(error))); }
}
async function commitDocumentationDelivery(mcp, preserved) {
  const { readFileSync, writeFileSync: write } = require("node:fs");
  const written = preserved.map(([relative]) => [relative, readFileSync(relative)]);
  for (const [relative, bytes] of preserved) write(relative, bytes);
  const committed = await mcp.callTool("commit", {}, { timeoutMs: 120000 });
  const structured = committed && committed.structuredContent || null;
  if (!committed || committed.isError === true || !structured || structured.committed !== true) {
    throw refuse("commit", "commit_not_confirmed:" +
      JSON.stringify(structured || (committed && committed.content) || null).slice(0, 1000));
  }
  for (const [relative, bytes] of written) write(relative, bytes);
}
(async () => {
  const mcp = await connectFixedProbeMcp({ clientName: "assignment-story-probe" });
  const assignment = await readFixedProbeAssignment(mcp);
  const mutated = mutateRetrieved(assignment.guidance);
  const guidance = mutated.text;
  const summary = extractSummary(guidance);
  const task = parseTask(summary);
  output = task.output;
  const keys = parseConfig(summary);
  const summarySha256 = sha(Buffer.from(summary, "utf8"));
  const material = parseMaterial(guidance);
  const source = readSource(task.source);
  const documentation = "# Story configuration " + task.id + "\n\n" +
    keys.map(key => "- \x60" + key + "\x60").join("\n") + "\n";
  try { writeFileSync(task.documentation, documentation, "utf8"); }
  catch (error) { throw refuse("documentation", "documentation_unwritable:" + (error.code || String(error))); }
  const preserved = scenario === "commit_delivery" ? snapshotProbeTargets() : null;
  const physical = probeAssignedPhysicalAccess();
  if (preserved !== null) await commitDocumentationDelivery(mcp, preserved);
  const digestInput = task.id + "\n" + summarySha256 + "\n" + keys.join(",") + "\n" +
    task.documentation + "\n" + source.sha256 + "\n" + material.tokens.join("\n") + "\n";
  report({
    schema_version: "assignment-story-result.v1",
    ok: true,
    family,
    task_id: task.id,
    summary_sha256: summarySha256,
    configuration_keys: keys,
    documentation_path: task.documentation,
    documentation_sha256: sha(documentation),
    source_path: task.source,
    source_sha256: source.sha256,
    source_token: source.token,
    material_tokens: material.tokens,
    material_occurrences: material.occurrences,
    result_sha256: sha(digestInput),
    output_path: task.output,
    delivered_prompt_sha256: sha(prompt),
    assignment_read: { reads: assignment.reads, source_digest: assignment.source_digest,
      identity: assignment.identity, guidance_sha256: sha(assignment.guidance) },
    content: observeContent(guidance, assignment.reads),
    mutation: mutated.mutation,
    cwd: process.cwd(),
    diagnostic_namespace_pid: process.pid,
    mcp: { authenticated: true, protocol_version: mcp.initialized.protocolVersion || null,
      tool_count: mcp.tools === null ? null : mcp.tools.length,
      tools_sha256: sha(JSON.stringify(mcp.tools || [])) },
    physical
  });
  // Hold with the authenticated conduit open until the host stops and reaps
  // this attempt; exceeding the bounded deadline is a failed observation.
  setTimeout(() => {
    process.stderr.write("assignment story probe hold deadline exceeded\n");
    process.exit(3);
  }, holdMs);
})().catch(error => {
  report({ schema_version: "assignment-story-result.v1", ok: false, family,
    stage: error.stage || "worker", error: error.message || String(error) });
  process.exit(1);
});
`;

function assertFixtureDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !existsSync(value) ||
      !statSync(value).isDirectory() || realpathSync(value) !== value) {
    throw new TypeError(`assignment story probe ${label} must be an existing canonical absolute directory`);
  }
  return value;
}

function planBinds(bwrapArgs) {
  const binds = [];
  for (let index = 0; index < bwrapArgs.length; index += 1) {
    if (/^--(?:ro-)?bind(?:-try)?$/u.test(bwrapArgs[index])) {
      binds.push({ flag: bwrapArgs[index], src: bwrapArgs[index + 1], dst: bwrapArgs[index + 2] });
      index += 2;
    }
  }
  return binds;
}

function writeEvidence(directory, record) {
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}.json`;
  const staged = path.join(directory, `.${name}.tmp`);
  writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(staged, path.join(directory, name));
}

function launchStoryProbe({ family, scenario, evidenceDirectory }, plan, options) {
  const authority = plan?.workerScopeAuthority ?? null;
  const substituted = substituteFixedProbeCommand(plan, {
    family,
    label: "assignment story probe",
    programSource: ASSIGNMENT_STORY_PROBE_SOURCE,
    programArgs: ({ prompt, finalPath }) => [family, finalPath ?? "",
      Buffer.from(prompt, "utf8").toString("base64"), String(ASSIGNMENT_STORY_HOLD_DEADLINE_MS), scenario]
  });
  const childCreated = scenario !== "no_child";

  writeEvidence(evidenceDirectory, {
    schema_version: ASSIGNMENT_STORY_EVIDENCE_SCHEMA,
    adapter: "assignment-story-probe",
    family,
    scenario,
    child_created: childCreated,
    cwd: typeof plan.cwd === "string" ? plan.cwd : null,
    agent_subject: plan.env?.AGENT_SUBJECT ?? null,
    native_plan: {
      result_transport: substituted.resultTransport,
      native_command: substituted.nativeCommand,
      prompt_is_final_argv: substituted.childArgs.at(-1) === substituted.prompt,
      option_terminator_before_prompt: substituted.childArgs.at(-2) === "--",
      final_message_path: substituted.finalPath,
      child_argv_length: substituted.childArgs.length
    },
    native_prompt_sha256: sha256(substituted.prompt),

    delivered_prompt_sha256: sha256(substituted.prompt),
    bwrap_argv_sha256: sha256(JSON.stringify(substituted.bwrapArgs)),
    conduit_projected: substituted.bwrapArgs.includes("/run/agent-launch/mcp.sock"),
    probe_executable: process.execPath,
    binds: planBinds(substituted.bwrapArgs),
    resolved_scope: authority?.resolved_scope ?? null,
    scope_exclusions: authority?.scope_exclusions ?? null,
    declared_scope: authority === null ? null : {
      read_scope: authority.read_scope ?? null,
      repo_paths: authority.repo_paths ?? null,
      write_scope: authority.write_scope ?? null
    },
    recorded_at: new Date().toISOString()
  });
  if (!childCreated) return null;
  return spawnIsolated(substituted.probePlan, options);
}

const storyCodexSeams = new WeakSet();
const storyClaudeSeams = new WeakSet();

export function isAssignmentStoryCodexExecutorTestSeams(value) {
  return storyCodexSeams.has(value);
}

export function isAssignmentStoryClaudeExecutorTestSeams(value) {
  return storyClaudeSeams.has(value);
}

export function buildAssignmentStoryProbeTestComposition({
  family, scenario, evidenceDirectory, hostHome = null
} = {}) {
  if (!ASSIGNMENT_STORY_FAMILIES.includes(family)) {
    throw new TypeError("assignment story probe family must be codex or claude");
  }
  if (!ASSIGNMENT_STORY_SCENARIOS.includes(scenario)) {
    throw new TypeError(`assignment story probe scenario must be one of ${ASSIGNMENT_STORY_SCENARIOS.join(", ")}`);
  }
  const settings = Object.freeze({ family, scenario,
    evidenceDirectory: assertFixtureDirectory(evidenceDirectory, "evidence directory") });
  if (family === "codex") {
    if (hostHome !== null) throw new TypeError("the Codex story composition takes no host home");
    const seams = Object.freeze({
      spawn: (plan, stdioOptions = {}) => launchStoryProbe(settings, plan, stdioOptions)
    });
    storyCodexSeams.add(seams);
    return Object.freeze({ codexExecutorTestSeams: seams });
  }
  const home = assertFixtureDirectory(hostHome, "host home");
  const seams = Object.freeze({
    spawnIsolated: (plan, options = {}) => launchStoryProbe(settings, plan, options),
    readLauncherOwnedHostHome: () => home
  });
  storyClaudeSeams.add(seams);
  return Object.freeze({ claudeExecutorTestSeams: seams });
}
