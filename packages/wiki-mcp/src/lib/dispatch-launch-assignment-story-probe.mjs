

import { createHash, randomBytes } from "node:crypto";
import { existsSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { spawnIsolated } from
  "@agent-chassis/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  FIXED_PROBE_DELIVERED_SCOPE_SOURCE,
  FIXED_PROBE_PHYSICAL_ACCESS_SOURCE,
  substituteFixedProbeCommand
} from "./dispatch-launch-fixed-probe-protocol.mjs";

export const ASSIGNMENT_STORY_SCENARIOS = Object.freeze([
  "normal", "task_substitution", "material_substitution", "no_child"
]);
export const ASSIGNMENT_STORY_FAMILIES = Object.freeze(["codex", "claude"]);

export const ASSIGNMENT_STORY_HOLD_DEADLINE_MS = 180_000;
export const ASSIGNMENT_STORY_EVIDENCE_SCHEMA = "assignment-story-probe-evidence.v1";
export const ASSIGNMENT_STORY_RESULT_SCHEMA = "assignment-story-result.v1";

export const STORY_TASK_PATTERN =
  /STORY-TASK id=([0-9a-f]{32}); source=([^;\s]+); output=([^;\s]+); end/gu;
export const STORY_MATERIAL_PATTERN = /STORY-MATERIAL token=([0-9a-f]{32})/gu;

export function storyTaskLine({ id, source, output }) {
  return `STORY-TASK id=${id}; source=${source}; output=${output}; end`;
}

export function storyMaterialText(token) {
  return `STORY-MATERIAL token=${token}`;
}

export function complementStoryToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/u.test(token)) {
    throw new TypeError("story token must be 32 lowercase hex digits");
  }
  return [...token].map((digit) => (15 - Number.parseInt(digit, 16)).toString(16)).join("");
}

export function storyResultDigest({ taskId, sourceSha256, materialTokens }) {
  return `sha256:${createHash("sha256")
    .update(`${taskId}\n${sourceSha256}\n${materialTokens.join("\n")}\n`).digest("hex")}`;
}

const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const ASSIGNMENT_STORY_PROBE_SOURCE = `${FIXED_PROBE_PHYSICAL_ACCESS_SOURCE}
${FIXED_PROBE_DELIVERED_SCOPE_SOURCE}` + String.raw`
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const [family, finalPath, encodedPrompt, holdText] = process.argv.slice(1);
const prompt = Buffer.from(encodedPrompt, "base64").toString("utf8");
const holdMs = Number(holdText);
const sha = value => "sha256:" + createHash("sha256").update(value).digest("hex");
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
function parseTask() {
  const found = [...prompt.matchAll(/STORY-TASK id=([0-9a-f]{32}); source=([^;\s]+); output=([^;\s]+); end/gu)];
  const distinct = new Set(found.map(match => match[0]));
  if (distinct.size === 0) throw refuse("task", "task_missing");
  if (distinct.size > 1) throw refuse("task", "task_ambiguous");
  return { id: found[0][1], source: found[0][2], output: found[0][3] };
}
function parseMaterial() {
  const occurrences = {};
  const order = [];
  for (const match of prompt.matchAll(/STORY-MATERIAL token=([0-9a-f]{32})/gu)) {
    if (!Object.hasOwn(occurrences, match[1])) { occurrences[match[1]] = 0; order.push(match[1]); }
    occurrences[match[1]] += 1;
  }
  if (order.length < 2) throw refuse("material", "material_missing");
  if (order.length > 2) throw refuse("material", "material_ambiguous");
  return { tokens: order, occurrences };
}
function readSource(relative) {
  let bytes;
  try { bytes = readFileSync(relative); }
  catch (error) { throw refuse("source", "source_unreadable:" + (error.code || String(error))); }
  const token = bytes.toString("utf8").match(/token = "([^"]+)"/u);
  if (!token) throw refuse("source", "source_token_missing");
  return { sha256: sha(bytes), token: token[1] };
}
(async () => {
  const task = parseTask();
  output = task.output;
  const material = parseMaterial();
  const source = readSource(task.source);
  const mcp = await connectFixedProbeMcp({ clientName: "assignment-story-probe" });
  const physical = probeAssignedPhysicalAccess();
  const digestInput = task.id + "\n" + source.sha256 + "\n" + material.tokens.join("\n") + "\n";
  report({
    schema_version: "assignment-story-result.v1",
    ok: true,
    family,
    task_id: task.id,
    source_path: task.source,
    source_sha256: source.sha256,
    source_token: source.token,
    material_tokens: material.tokens,
    material_occurrences: material.occurrences,
    result_sha256: sha(digestInput),
    output_path: task.output,
    delivered_prompt_sha256: sha(prompt),
    delivered_scope: parseDeliveredScope(prompt),
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

function mutateDeliveredPrompt(prompt, scenario) {
  const pattern = scenario === "task_substitution" ? STORY_TASK_PATTERN
    : scenario === "material_substitution" ? STORY_MATERIAL_PATTERN : null;
  if (pattern === null) return { prompt, mutation: null };
  const first = [...prompt.matchAll(pattern)][0] ?? null;
  if (first === null) return { prompt, mutation: { scenario, applied: false } };
  const from = first[1];
  const to = complementStoryToken(from);
  return { prompt: prompt.split(from).join(to),
    mutation: { scenario, applied: true, from, to, replaced: prompt.split(from).length - 1 } };
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
  let delivered = null;
  const substituted = substituteFixedProbeCommand(plan, {
    family,
    label: "assignment story probe",
    programSource: ASSIGNMENT_STORY_PROBE_SOURCE,
    programArgs: ({ prompt, finalPath }) => {
      delivered = mutateDeliveredPrompt(prompt, scenario);
      return [family, finalPath ?? "", Buffer.from(delivered.prompt, "utf8").toString("base64"),
        String(ASSIGNMENT_STORY_HOLD_DEADLINE_MS)];
    }
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
    delivered_prompt_sha256: sha256(delivered.prompt),
    mutation: delivered.mutation,
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
