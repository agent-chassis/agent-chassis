

import {
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { spawnIsolated } from
  "@agent-chassis/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR
} from "@agent-chassis/agent-launch-cli/src/lib/codex-role-mcp-env.mjs";
import {
  FIXED_PROBE_CONNECTED_DIRECTIVES_SOURCE,
  FIXED_PROBE_DELIVERED_SCOPE_SOURCE,
  FIXED_PROBE_PHYSICAL_ACCESS_SOURCE,
  FIXED_PROBE_PROMPT_SECTION_SOURCE,
  substituteFixedProbeCommand
} from "./dispatch-launch-fixed-probe-protocol.mjs";

const dispatchCodexTestSeamEvidence = [];

const acceptSucceedCodexExecutorTestSeams = new WeakSet();
const confinedWorkerProbeCodexExecutorTestSeams = new WeakSet();
const connectedDeliveryWitnessCodexExecutorTestSeams = new WeakSet();
const advisoryReviewMaterialProbeCodexExecutorTestSeams = new WeakSet();

export function isAcceptSucceedCodexExecutorTestSeams(value) {
  return acceptSucceedCodexExecutorTestSeams.has(value);
}

export function isConfinedWorkerProbeCodexExecutorTestSeams(value) {
  return confinedWorkerProbeCodexExecutorTestSeams.has(value);
}

export function isConnectedDeliveryWitnessCodexExecutorTestSeams(value) {
  return connectedDeliveryWitnessCodexExecutorTestSeams.has(value);
}

export function isAdvisoryReviewMaterialProbeCodexExecutorTestSeams(value) {
  return advisoryReviewMaterialProbeCodexExecutorTestSeams.has(value);
}
const DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX = "mcp_servers.wiki.env.";
const DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_ALLOWLIST = new Set([
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR,
  WIKI_MCP_DISPATCH_WORKTREE_ROOT_ENV_VAR,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR,
  WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
  WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR
]);

export function consumeDispatchCodexTestSeamEvidence() {
  return dispatchCodexTestSeamEvidence.splice(0, dispatchCodexTestSeamEvidence.length);
}

function captureDispatchCodexTestWikiChildEnv(childArgs) {
  const wikiChildEnv = {};
  for (let index = 0; index < childArgs.length - 1; index += 1) {
    if (childArgs[index] !== "-c") continue;
    const override = childArgs[index + 1];
    index += 1;
    if (typeof override !== "string" ||
        !override.startsWith(DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX)) {
      continue;
    }
    const separator = override.indexOf("=", DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX.length);
    if (separator < 0) continue;
    const key = override.slice(DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_PREFIX.length, separator);
    if (!DISPATCH_CODEX_TEST_WIKI_CHILD_ENV_ALLOWLIST.has(key)) continue;
    const value = JSON.parse(override.slice(separator + 1));
    if (typeof value !== "string") {
      throw new Error(`test seam wiki child environment ${key} must be a string`);
    }

    wikiChildEnv[key] = value;
  }
  return Object.freeze(wikiChildEnv);
}

export function buildAcceptSucceedCodexExecutorTestSeams({ releaseSignalPath = null } = {}) {
  if (releaseSignalPath !== null &&
      (typeof releaseSignalPath !== "string" || !releaseSignalPath.startsWith("/"))) {
    throw new TypeError("accept-succeed seam releaseSignalPath must be an absolute path or null");
  }

  const seams = Object.freeze({

    spawn: (plan) => {
      const childArgs = Array.isArray(plan?.childArgs) ? plan.childArgs : [];
      const finalPathIndex = childArgs.indexOf("--output-last-message");
      const finalPath = finalPathIndex >= 0 && typeof childArgs[finalPathIndex + 1] === "string"
        ? childArgs[finalPathIndex + 1]
        : null;
      const child = createCodexExecutorTestSeamChild(finalPath, { releaseSignalPath });
      let stdinClosed = false;
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        repo: typeof plan?.repo === "string" ? plan.repo : null,
        cwd: typeof plan?.cwd === "string" ? plan.cwd : null,
        sparse_worker_namespace: plan?.sparseWorkerNamespace === null || plan?.sparseWorkerNamespace === undefined
          ? null
          : Object.freeze({
              authority: Object.freeze({
                read_scope: Object.freeze([...plan.sparseWorkerNamespace.authority.read_scope]),
                repo_paths: Object.freeze([...plan.sparseWorkerNamespace.authority.repo_paths]),
                write_scope: Object.freeze([...plan.sparseWorkerNamespace.authority.write_scope])
              }),
              readable: Object.freeze(plan.sparseWorkerNamespace.readable.map((entry) => entry.absolute)),
              writable: Object.freeze(plan.sparseWorkerNamespace.writable.map((entry) => entry.absolute))
            }),
        bwrap_args: Object.freeze(Array.isArray(plan?.bwrapArgs) ? [...plan.bwrapArgs] : []),
        writable_roots: Object.freeze(Array.isArray(plan?.writableRoots) ? [...plan.writableRoots] : []),
        writable_files: Object.freeze(Array.isArray(plan?.writableFiles)
          ? plan.writableFiles.map((entry) => Object.freeze({
              real: entry.real,
              precreated: entry.precreated
            }))
          : []),
        wiki_mcp_child_env: captureDispatchCodexTestWikiChildEnv(childArgs),
        close_stdin: () => {
          if (stdinClosed) return;
          stdinClosed = true;
          child.process.stdin.end();
        },
        terminal: child.terminal
      }));
      return child.process;
    }
  });
  acceptSucceedCodexExecutorTestSeams.add(seams);
  return seams;
}

const CONFINED_WORKER_PROBE_SOURCE = `${FIXED_PROBE_PHYSICAL_ACCESS_SOURCE}
${FIXED_PROBE_DELIVERED_SCOPE_SOURCE}` + String.raw`
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const finalPath = process.argv[1];
const prompt = Buffer.from(process.argv[2], "base64").toString("utf8");
const processConnection = JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
const scopeAuthority = JSON.parse(Buffer.from(process.argv[4], "base64").toString("utf8"));
let settled = false;
function persist(value) {
  const bytes = JSON.stringify(value) + "\n";
  let written = false;
  try { writeFileSync("src/worker-probe-receipt.json", bytes, "utf8"); written = true; } catch {}
  try { writeFileSync(finalPath, bytes, "utf8"); written = true; } catch {}
  if (!written) throw new Error("worker probe has no writable receipt path");
}
persist({ schema_version: "confined-worker-probe-receipt.v1", stage: "started", pid: process.pid });
function finish(extra) {
  if (settled) return;
  settled = true;
  const receipt = {
    schema_version: "confined-worker-probe-receipt.v1",
    ...extra,
    pid: process.pid,
    cwd: process.cwd(),
    process_connection: processConnection,
    delivered_scope: parseDeliveredScope(prompt),
    authenticated_scope: scopeAuthority,
    assignment_sha256: "sha256:" + createHash("sha256").update(prompt).digest("hex"),
    assignment: {
      selected_unit: (prompt.match(/WK-\d{4,}#SLICE-\d{3}/u) || [null])[0],
      has_acceptance_marker: prompt.includes("WITNESS-ACCEPTANCE-MARKER"),
      has_sibling_marker: prompt.includes("WITNESS-SIBLING-MARKER"),
      has_parent_marker: prompt.includes("WITNESS-PARENT-MARKER"),
      has_validation_marker: prompt.includes("WITNESS-VALIDATION-MARKER"),
      has_parent_validation_marker: prompt.includes("WITNESS-PARENT-VALIDATION-MARKER"),
      has_parent_dependency_marker: prompt.includes("WK-8998"),
      has_material_marker: prompt.includes("WITNESS-IMMUTABLE-MATERIAL-MARKER"),
      has_selected_material_marker: prompt.includes("WITNESS-SELECTED-MATERIAL-MARKER"),
      has_later_material_marker: prompt.includes("WITNESS-LATER-MATERIAL-MARKER"),
      parent_material_index: prompt.indexOf("WITNESS-IMMUTABLE-MATERIAL-MARKER"),
      selected_material_index: prompt.indexOf("WITNESS-SELECTED-MATERIAL-MARKER"),
      parent_material_occurrences: prompt.split("WITNESS-IMMUTABLE-MATERIAL-MARKER").length - 1
    },
    ...probeAssignedPhysicalAccess()
  };
  persist(receipt);
  setInterval(() => {}, 1000);
}
(async () => {
  const mcp = await connectFixedProbeMcp({ clientName: "confined-worker-probe",
    onSocketError: error => finish({ ok: false, stage: "mcp_socket", error: error.message }) });
  finish({ ok: true, mcp: { protocol_version: mcp.initialized.protocolVersion || null, tool_count: mcp.tools === null ? null : mcp.tools.length, tools_sha256: "sha256:" + createHash("sha256").update(JSON.stringify(mcp.tools || [])).digest("hex") } });
})().catch(error => finish({ ok: false, stage: "mcp_handshake", error: error.message }));
`;

export function buildConfinedWorkerProbeCodexExecutorTestSeams() {
  const seams = Object.freeze({
    spawn: (plan, stdioOptions = {}) => {
      const authority = plan.workerScopeAuthority;
      if (authority?.resolved_scope === null || authority?.resolved_scope === undefined) {
        throw new TypeError("confined worker probe requires frozen resolved scope authority");
      }
      const processConnection = Object.freeze({
        assigned_unit: plan.env?.AGENT_SUBJECT ?? null,
        worktree_path: plan.cwd ?? null
      });
      const scopeAuthority = Object.freeze({
        declared: Object.freeze({
          read_scope: Object.freeze([...(authority.read_scope ?? [])]),
          repo_paths: Object.freeze([...(authority.repo_paths ?? [])]),
          write_scope: Object.freeze([...(authority.write_scope ?? [])])
        }),
        resolved_scope: authority.resolved_scope,
        exclusions: Object.freeze([...(authority.scope_exclusions ?? [])])
      });
      const { prompt, finalPath, childArgs, bwrapArgs, probePlan } = substituteFixedProbeCommand(plan, {
        family: "codex",
        label: "confined worker probe",
        programSource: CONFINED_WORKER_PROBE_SOURCE,
        programArgs: ({ prompt: assignment, finalPath: finalMessagePath }) => [
          finalMessagePath,
          Buffer.from(assignment, "utf8").toString("base64"),
          Buffer.from(JSON.stringify(processConnection), "utf8").toString("base64"),
          Buffer.from(JSON.stringify(scopeAuthority), "utf8").toString("base64")
        ]
      });
      const wikiChildEnv = captureDispatchCodexTestWikiChildEnv(childArgs);
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        kind: "confined_worker_probe",
        repo: plan.repo,
        cwd: plan.cwd,
        final_path: finalPath,
        assignment_sha256: `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
        bwrap_argv_sha256: `sha256:${createHash("sha256")
          .update(JSON.stringify(bwrapArgs)).digest("hex")}`,
        has_conduit_projection: bwrapArgs.includes("/run/agent-launch/mcp.sock"),
        executable: process.execPath,
        wiki_mcp_child_env: wikiChildEnv
      }));
      return spawnIsolated(probePlan, stdioOptions);
    }
  });
  confinedWorkerProbeCodexExecutorTestSeams.add(seams);
  return seams;
}

export const ADVISORY_REVIEW_MATERIAL_PROBE_PATH = "review-material/witness.txt";

const ADVISORY_REVIEW_MATERIAL_PROBE_SOURCE = `${FIXED_PROBE_PHYSICAL_ACCESS_SOURCE}` + String.raw`
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const finalPath = process.argv[1];
const prompt = Buffer.from(process.argv[2], "base64").toString("utf8");
const materialPath = ` + JSON.stringify(ADVISORY_REVIEW_MATERIAL_PROBE_PATH) + String.raw`;
const read = sourceRead(materialPath);
const bytes = read.readable ? Buffer.from(read.text, "utf8") : null;
writeFileSync(finalPath, JSON.stringify({
  schema_version: "advisory-review-material-probe-receipt.v1",
  ok: read.readable === true,
  pid: process.pid,
  cwd: process.cwd(),
  assignment_sha256: "sha256:" + createHash("sha256").update(prompt).digest("hex"),
  material: {
    path: materialPath,
    kind: fileKind(materialPath),
    readable: read.readable,
    text: read.readable ? read.text : null,
    utf8_bytes: bytes === null ? null : bytes.length,
    sha256: bytes === null ? null : "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    code: read.readable ? null : read.code
  }
}) + "\n", "utf8");
`;

export function buildAdvisoryReviewMaterialProbeCodexExecutorTestSeams() {
  const seams = Object.freeze({
    spawn: (plan, stdioOptions = {}) => {
      const { prompt, finalPath, childArgs, bwrapArgs, probePlan } = substituteFixedProbeCommand(plan, {
        family: "codex",
        label: "advisory review material probe",
        programSource: ADVISORY_REVIEW_MATERIAL_PROBE_SOURCE,
        programArgs: ({ prompt: assignment, finalPath: finalMessagePath }) => [
          finalMessagePath, Buffer.from(assignment, "utf8").toString("base64")]
      });
      const child = spawnIsolated(probePlan, stdioOptions);

      const terminal = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve(Object.freeze({ code, signal, error: null })));
        child.once("error", (error) => resolve(Object.freeze({ code: null, signal: null,
          error: error?.code ?? error?.message ?? String(error) })));
      });
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        kind: "advisory_review_material_probe",
        repo: plan.repo,
        cwd: plan.cwd,
        final_path: finalPath,
        assignment_sha256: `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
        bwrap_argv_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bwrapArgs)).digest("hex")}`,
        has_conduit_projection: bwrapArgs.includes("/run/agent-launch/mcp.sock"),
        executable: process.execPath,
        pid: Number.isInteger(child.pid) ? child.pid : null,
        wiki_mcp_child_env: captureDispatchCodexTestWikiChildEnv(childArgs),
        terminal
      }));
      return child;
    }
  });
  advisoryReviewMaterialProbeCodexExecutorTestSeams.add(seams);
  return seams;
}

const CONNECTED_DELIVERY_WITNESS_SOURCE = FIXED_PROBE_PROMPT_SECTION_SOURCE +
  FIXED_PROBE_CONNECTED_DIRECTIVES_SOURCE + String.raw`
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const finalPath = process.argv[1];
const prompt = Buffer.from(process.argv[2], "base64").toString("utf8");
const scenario = process.argv[3];
let mcp = null;
function finish(value, exitCode = 0) {
  writeFileSync(finalPath, JSON.stringify(value) + "\n", "utf8");
  if (mcp !== null) mcp.socket.end();
  process.exitCode = exitCode;
}
function summary(result) {
  return {
    is_error: result && result.isError === true,
    structured: result && result.structuredContent || null,
    content: result && result.content || null
  };
}
// The managed-worker guide as delivered: its heading through the canonical
// record, reconstructed and trimmed as the package reader trims it.
function observeManagedGuide() {
  const heading = "# Managed implementation worker";
  const body = promptSectionAfter(prompt, "\n" + heading + "\n", "\n## Canonical Record\n");
  const text = body === null ? null : (heading + "\n" + body).trim();
  return {
    text,
    occurrences: text === null ? 0 : prompt.split(text).length - 1,
    heading_occurrences: prompt.split(heading).length - 1,
    other_guide_headings: ["# Direct implementation worker", "# Reviewer", "# Orchestrator"]
      .filter(other => prompt.includes(other)),
    order: {
      role_header: prompt.indexOf("\nRole: implementation worker for "),
      guide: text === null ? -1 : prompt.indexOf(text),
      canonical_record: prompt.indexOf("\n## Canonical Record\n"),
      operative_notes: prompt.indexOf("\n### Operative Notes\n"),
      acceptance_criteria: prompt.indexOf("\n### Acceptance Criteria\n")
    }
  };
}
(async () => {
  mcp = await connectFixedProbeMcp({ clientName: "connected-delivery-witness", requestTimeoutMs: 30000 });
  const callTool = (name, args) => mcp.callTool(name, args);
  const selectedUnit = (prompt.match(/^Role: implementation worker for (WK-\d{4,}#SLICE-\d{3})\.$/mu) ||
    [null, null])[1];
  if (!selectedUnit) throw new Error("assignment carries no selected slice");
  const invocations = [];
  let instruction = null;
  let parentControl = null;
  if (scenario === "selected") {
    instruction = decodeConnectedDirectives(prompt);
    instruction.guide = observeManagedGuide();
    parentControl = summary(await callTool("workspace_verify_proof", instruction.requests.parent_control));
    writeFileSync("dependency.mjs", "export function value() { return 42; }\n", "utf8");
    invocations.push(summary(await callTool("workspace_verify_proof", instruction.requests.verify)));
    writeFileSync("dependency.mjs", "export function value() { return 43; }\n", "utf8");
    invocations.push(summary(await callTool("workspace_verify_proof", instruction.requests.verify)));
    writeFileSync("dependency.mjs", "export function value() { return 42; }\n", "utf8");
    invocations.push(summary(await callTool("workspace_verify_proof", instruction.requests.verify)));
  } else if (scenario === "unselected") {
    writeFileSync("dependency.mjs", "export function value() { return 42; }\n", "utf8");
    invocations.push(summary(await callTool("workspace_verify_proof", { subject: selectedUnit })));
  } else if (scenario === "timeout") {
    writeFileSync("dependency.mjs", "export function value() { return 42; }\n", "utf8");
    invocations.push(summary(await callTool("workspace_verify_proof",
      { subject: selectedUnit, timeout: { seconds: 12 } })));
  } else if (scenario === "observation_delivery") {
    writeFileSync("src/canary.txt", "WK-2671 observation delivery\n", "utf8");
  } else {
    throw new Error("unknown fixed connected witness scenario");
  }
  const commit = summary(await callTool("commit", {}));
  if (scenario === "observation_delivery" &&
      (commit.is_error || !commit.structured || commit.structured.committed !== true)) {
    throw new Error("observation delivery commit was not reported: " + JSON.stringify(commit));
  }
  finish({
    schema_version: "connected-delivery-witness-receipt.v1",
    ok: true,
    scenario,
    selected_unit: selectedUnit,
    assignment_sha256: "sha256:" + createHash("sha256").update(prompt).digest("hex"),
    ...(instruction === null ? {} : { instruction_observation: instruction, parent_control: parentControl }),
    invocations,
    commit
  });
})().catch(error => finish({ schema_version: "connected-delivery-witness-receipt.v1", ok: false,
  scenario, stage: "worker", error: error && error.stack || String(error) }, 1));
`;

const PYTHON_IDENTITY = "import importlib.util, json, sys; print(json.dumps({'executable': sys.executable, " +
  "'prefix': sys.prefix, 'base_prefix': sys.base_prefix, 'packages': {name: importlib.util.find_spec(name) " +
  "is not None for name in ('pytest', 'stestr')}}))";

export const CONNECTED_EXECUTABLE_MATRIX = Object.freeze([
  { family: "node-test", toolchain: "node", module: "dependency.mjs",
    initialSource: "export function value() { return 42; }\n",
    commands: [{ role: "node", cwd: ".", argv: ["node", "--test", "--test-name-pattern=^selected$",
      "nested.test.mjs"] }],
    identities: [{ role: "node", cwd: ".", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "jest", toolchain: "node", module: "javascript/src/answer.cjs",
    commands: [{ role: "node", cwd: "javascript", argv: ["node", "node_modules/jest/bin/jest.js",
      "--ci", "--testNamePattern", "^answer returns 42$", "jest/answer.test.cjs"] }],
    identities: [{ role: "node", cwd: "javascript", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "vitest", toolchain: "node", module: "javascript/src/answer.ts",

    commands: [{ role: "node", cwd: "javascript", argv: ["node", "node_modules/vitest/vitest.mjs",
      "run", "--configLoader", "runner", "--testNamePattern", "^answer returns 42$",
      "vitest/answer.test.ts"] }],
    identities: [{ role: "node", cwd: "javascript", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "mocha", toolchain: "node", module: "javascript/src/answer.ts",
    commands: [{ role: "node", cwd: "javascript", argv: ["node", "node_modules/mocha/bin/mocha.js",
      "--grep", "^answer returns 42$", "mocha/answer.spec.ts"] }],
    identities: [{ role: "node", cwd: "javascript", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "ava", toolchain: "node", module: "javascript/src/answer.mjs",

    commands: [{ role: "node", cwd: "javascript", argv: ["node", "node_modules/ava/entrypoints/cli.js",
      "ava/answer.spec.mjs:4"] }],
    identities: [{ role: "node", cwd: "javascript", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "lib0-testing", toolchain: "node", module: "javascript/src/answer.mjs",
    commands: [{ role: "node", cwd: "javascript", argv: ["node", "lib0/answer.spec.mjs",
      "--filter", "testReturns42"] }],
    identities: [{ role: "node", cwd: "javascript", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
  { family: "deno", toolchain: "deno", module: "deno/answer.ts",
    commands: [{ role: "deno", cwd: "deno", argv: ["deno", "test", "--frozen", "--cached-only",
      "--filter", "returns 42", "answer_test.ts"] }],
    identities: [{ role: "deno", cwd: "deno", kind: "self",
      argv: ["deno", "eval", "--no-check", "console.log(Deno.execPath())"] }] },
  { family: "pytest", toolchain: "python", module: "app/answer.py",
    commands: [{ role: "python", cwd: ".", argv: ["python3", "-m", "pytest", "-q",
      "tests/test_answer.py::test_returns_42"] }],
    identities: [{ role: "python", cwd: ".", kind: "python", argv: ["python3", "-c", PYTHON_IDENTITY] }] },
  { family: "stestr", toolchain: "python", module: "python-stestr/unit/answer.py",

    commands: [{ role: "python", cwd: "python-stestr", argv: ["python3", "-m", "stestr",
      "--repo-url", "/tmp", "run", "--serial", "unit.test_answer.AnswerTests.test_returns_42"] }],
    identities: [{ role: "python", cwd: "python-stestr", kind: "python", argv: ["python3", "-c", PYTHON_IDENTITY] }] },
  { family: "go-test", toolchain: "go", module: "go/calc/answer.go",
    commands: [
      { role: "go", cwd: "go", argv: ["go", "test", "-count=1", "-run", "^TestAnswer$", "./calc"] },
      { role: "go", cwd: "go", argv: ["go", "build", "./..."] },
      { role: "gofmt", cwd: "go", argv: ["gofmt", "-l", "calc/answer.go"] }],
    identities: [
      { role: "go", cwd: "go", kind: "self", argv: ["go", "env", "GOROOT"] },
      { role: "gofmt", cwd: "go", kind: "proc_exe", argv: ["gofmt"] }] },
  { family: "cargo-test", toolchain: "rust", module: "rust/src/lib.rs",
    commands: [
      { role: "cargo", cwd: "rust", argv: ["cargo", "test", "--frozen", "--offline", "--test", "answer",
        "--", "--exact", "returns_42"] },
      { role: "rustc", cwd: "rust", argv: ["rustc", "--edition", "2021", "--crate-type", "lib",
        "--emit", "metadata", "-o", "/tmp/wk2670-answer.rmeta", "tests/answer.rs"] }],
    identities: [
      { role: "cargo", cwd: "rust", kind: "cargo_env", argv: ["cargo", "wk2670-identity"] },
      { role: "rustc", cwd: "rust", kind: "self", argv: ["rustc", "--print", "sysroot"] }] }
].map((row) => Object.freeze({
  ...row,
  obligationId: `OBL-MATRIX-${row.family.toUpperCase()}`,
  commands: Object.freeze(row.commands.map((command) => Object.freeze({
    ...command, argv: Object.freeze([...command.argv]) }))),
  identities: Object.freeze(row.identities.map((probe) => Object.freeze({
    ...probe, argv: Object.freeze([...probe.argv]) })))
})));

export const CONNECTED_EXECUTABLE_RECOVERY_PROBES = Object.freeze([
  Object.freeze({ command: "python3", cwd: "/tmp", argv: Object.freeze(["python3", "-c", "print('ran')"]) }),
  Object.freeze({ command: "deno", cwd: "go", argv: Object.freeze(["deno", "eval", "console.log('ran')"]) })
]);

const CONNECTED_EXECUTABLE_MATRIX_SOURCE = String.raw`
const { createHash } = require("node:crypto");
const { accessSync, chmodSync, constants, mkdtempSync, readFileSync, readlinkSync, realpathSync,
  writeFileSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const finalPath = process.argv[1];
const prompt = Buffer.from(process.argv[2], "base64").toString("utf8");
const { matrix, recoveryProbes, projections: projectionDirectories, refusals: refusalCalls, scenario,
  schema } = JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8"));
const TAIL = 6000;
let mcp = null;
const sha256 = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const tail = text => text.length > TAIL ? text.slice(text.length - TAIL) : text;
function finish(value, exitCode = 0) {
  writeFileSync(finalPath, JSON.stringify(value) + "\n", "utf8");
  if (mcp !== null) mcp.socket.end();
  process.exitCode = exitCode;
}
function summary(result) {
  return {
    is_error: result && result.isError === true,
    structured: result && result.structuredContent || null,
    content: result && result.content || null
  };
}
const identities = new Map();
function resolveExecutable(name) {
  for (const directory of (process.env.PATH || "").split(":")) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try { accessSync(candidate, constants.X_OK); } catch { continue; }
    const real = realpathSync(candidate);
    if (!identities.has(real)) {
      let digest = null;
      let readError = null;
      try { digest = sha256(readFileSync(real)); } catch (error) { readError = error && error.code || String(error); }
      identities.set(real, { content_sha256: digest, read_error: readError });
    }
    return { found: true, path: candidate, realpath: real, ...identities.get(real) };
  }
  return { found: false, path: null, realpath: null, searched: process.env.PATH || null };
}
function runCommand(family, command) {
  const resolved = resolveExecutable(command.argv[0]);
  const started = Date.now();
  if (!resolved.found) {
    return { family, phase: "worker_command", role: command.role, cwd: command.cwd, argv: command.argv,
      resolved, ran: false, status: null, signal: null, error: "executable_not_on_path",
      stdout_tail: "", stderr_tail: "", duration_ms: 0 };
  }
  const result = spawnSync(resolved.path, command.argv.slice(1), { cwd: command.cwd,
    encoding: "utf8", timeout: 600000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
  return { family, phase: "worker_command", role: command.role, cwd: command.cwd, argv: command.argv,
    resolved, ran: !result.error || result.error.code === "ETIMEDOUT", status: result.status,
    signal: result.signal, error: result.error ? (result.error.code || result.error.message) : null,
    stdout_tail: tail(result.stdout || ""), stderr_tail: tail(result.stderr || ""),
    duration_ms: Date.now() - started };
}
// Native identity observations: the process that actually ran, independent of
// what the PATH lookup resolved to.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function procExe(resolved, command) {
  const shell = realpathSync("/bin/sh");
  const child = spawn(resolved.path, command.argv.slice(1), { cwd: command.cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("close", (status, signal) => resolve({ status, signal })));
  let observed = null;
  for (let attempt = 0; attempt < 2000 && observed === null; attempt += 1) {
    try {
      const exe = readlinkSync("/proc/" + child.pid + "/exe");
      if (exe !== shell && exe !== resolved.realpath) observed = exe;
    } catch {}
    if (observed === null) await sleep(5);
  }
  child.stdin.end();
  const { status, signal } = await exited;
  return { status, signal, stdout, stderr, observed };
}
async function runIdentity(family, probe) {
  const resolved = resolveExecutable(probe.argv[0]);
  const base = { family, phase: "native_identity", role: probe.role, cwd: probe.cwd, kind: probe.kind,
    argv: probe.argv, resolved };
  if (!resolved.found) return { ...base, status: null, observed: null, error: "executable_not_on_path" };
  let result;
  if (probe.kind === "proc_exe") {
    result = await procExe(resolved, probe);
  } else {
    let env = process.env;
    if (probe.kind === "cargo_env") {
      // cargo gives an external subcommand the CARGO path of its own executable.
      const directory = mkdtempSync("/tmp/wk2670-cargo-identity-");
      const script = path.join(directory, "cargo-wk2670-identity");
      writeFileSync(script, "#!/bin/sh\nprintf '%s' \"$CARGO\"\n");
      chmodSync(script, 0o755);
      env = { ...process.env, PATH: directory + ":" + (process.env.PATH || "") };
    }
    const run = spawnSync(resolved.path, probe.argv.slice(1), { cwd: probe.cwd, env, encoding: "utf8",
      timeout: 120000, killSignal: "SIGKILL" });
    const stdout = run.stdout || "";
    let observed = stdout.trim();
    if (probe.kind === "python") { try { observed = JSON.parse(stdout); } catch { observed = null; } }
    result = { status: run.status, signal: run.signal, stdout, stderr: run.stderr || "", observed,
      error: run.error ? (run.error.code || run.error.message) : null };
  }
  return { ...base, status: result.status, signal: result.signal, error: result.error || null,
    observed: result.observed, stdout_tail: tail(result.stdout), stderr_tail: tail(result.stderr) };
}
function mutated(text) {
  const index = text.indexOf("42");
  if (index < 0) throw new Error("matrix module has no declared answer literal");
  return text.slice(0, index) + "43" + text.slice(index + 2);
}
(async () => {
  mcp = await connectFixedProbeMcp({ clientName: "connected-executable-matrix",
    requestTimeoutMs: 30000 });
  const selectedUnit = (prompt.match(/WK-\d{4,}#SLICE-\d{3}/u) || [null])[0];
  if (!selectedUnit) throw new Error("assignment carries no selected slice");
  const environment = { cwd: process.cwd(),
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    variables: Object.fromEntries(["PATH", "HOME", "TMPDIR", "XDG_CACHE_HOME", "GOMODCACHE", "GOPROXY",
      "GOFLAGS", "GOCACHE", "GOPATH", "CARGO_HOME", "CARGO_TARGET_DIR", "RUSTUP_HOME", "DENO_DIR",
      "NODE_PATH", "VIRTUAL_ENV", "PYTHONPATH", "npm_config_cache"]
      .map(name => [name, process.env[name] === undefined ? null : process.env[name]])) };
  for (const row of matrix) {
    if (typeof row.initialSource === "string") writeFileSync(row.module, row.initialSource, "utf8");
  }
  const commands = [];
  for (const row of matrix) for (const command of row.commands) commands.push(runCommand(row.family, command));
  const identities = [];
  for (const row of matrix) for (const probe of row.identities) identities.push(await runIdentity(row.family, probe));
  const recoveries = recoveryProbes.map(probe => {
    const resolved = resolveExecutable(probe.argv[0]);
    const run = resolved.found ? spawnSync(resolved.path, probe.argv.slice(1), { cwd: probe.cwd,
      encoding: "utf8", timeout: 60000, killSignal: "SIGKILL" }) : null;
    return { ...probe, resolved, status: run ? run.status : null, signal: run ? run.signal : null,
      stdout_tail: tail(run && run.stdout || ""), stderr_tail: tail(run && run.stderr || "") };
  });
  // DEC-0158 projection probe: a prepared npm population must be visible inside
  // the selected checkout and must refuse mutation there.
  const { mkdirSync, statSync } = require("node:fs");
  const probeProjection = directory => {
    let visible;
    try { visible = { exists: true, directory: statSync(directory).isDirectory() }; }
    catch (error) { visible = { exists: false, code: error && error.code || String(error) }; }
    let mutation;
    try {
      mkdirSync(path.join(directory, ".wk2670-projection-probe"), { recursive: true });
      mutation = { denied: false };
    } catch (error) { mutation = { denied: true, code: error && error.code || String(error) }; }
    return { directory, visible, mutation };
  };
  const projections = projectionDirectories.map(probeProjection);
  // Explicit calls the plan expects to be refused before any execution, made
  // while every module holds its original bytes.
  const refusals = [];
  for (const call of refusalCalls) {
    const args = { ...call.arguments };
    if (args.subject === "<selected-unit>") args.subject = selectedUnit;
    else args.source = { unit: selectedUnit };
    let result;
    try {
      result = summary(await mcp.callTool("workspace_verify_proof", { ...args, timeout: "long" },
        { timeoutMs: 600000 }));
    } catch (error) {
      result = { is_error: true, transport_error: error && error.message || String(error) };
    }
    refusals.push({ label: call.label, arguments: args, result });
  }
  const verifications = [];
  for (const row of matrix) {
    const original = readFileSync(row.module, "utf8");
    const steps = [["pass", original], ["fail", mutated(original)], ["recover", original]];
    for (const [step, text] of steps) {
      writeFileSync(row.module, text, "utf8");
      let result;
      try {
        result = summary(await mcp.callTool("workspace_verify_proof",
          { subject: row.obligationId, source: { unit: selectedUnit }, timeout: "long",
            ...(row.verifyArguments || {}) },
          { timeoutMs: 1900000 }));
      } catch (error) {
        result = { is_error: true, transport_error: error && error.message || String(error) };
      }
      verifications.push({ family: row.family, step, obligation_id: row.obligationId,
        module: row.module, module_sha256: sha256(Buffer.from(text, "utf8")), result });
    }
  }
  const finalSources = Object.fromEntries(matrix.map(row =>
    [row.module, sha256(readFileSync(row.module))]));
  const commit = summary(await mcp.callTool("commit", {}, { timeoutMs: 600000 }));
  finish({
    schema_version: schema,
    ok: true,
    scenario,
    selected_unit: selectedUnit,
    assignment_sha256: sha256(prompt),
    environment,
    commands,
    identities,
    recoveries,
    projections,
    refusals,
    verifications,
    final_sources: finalSources,
    commit
  });
})().catch(error => finish({ schema_version: schema, ok: false,
  scenario, stage: "worker", error: error && error.stack || String(error) }, 1));
`;

export const CONNECTED_MULTILINGUAL_JOURNEY = Object.freeze({
  rows: Object.freeze([

    { family: "node-test", toolchain: "node", module: "web/src/answer.mjs",
      obligationId: "OBL-ML-NODE-WORKSPACE", verifyArguments: { environment: "npm@web" },
      commands: [{ role: "node", cwd: "web", argv: ["node", "--test", "--test-name-pattern=^selected$",
        "node/answer.test.mjs"] }],
      identities: [{ role: "node", cwd: "web", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
    { family: "ava", toolchain: "node", module: "web/src/answer.mjs", obligationId: "OBL-ML-AVA-WORKSPACE",

      initialSource: "// verified through the prepared npm@web environment\nimport ms from 'ms';\n\n" +
        "export function answer() {\n  return 42;\n}\n\nexport function seconds(text) {\n" +
        "  return ms(text) / 1000;\n}\n",
      commands: [
        { role: "node", cwd: "web", argv: ["node", "--input-type=module", "-e",
          "const member = await import('@ml/label'); console.log(member.label);"] },
        { role: "node", cwd: "web", argv: ["node", "node_modules/ava/entrypoints/cli.js",
          "ava/workspace.spec.mjs"] }],
      identities: [{ role: "node", cwd: "web", kind: "self", argv: ["node", "-p", "process.execPath"] }] },
    { family: "pytest", toolchain: "python", module: "app/answer.py", obligationId: "OBL-ML-PYTEST",
      commands: [{ role: "python", cwd: ".", argv: ["python3", "-m", "pytest", "-q",
        "tests/test_answer.py::test_returns_42"] }],
      identities: [{ role: "python", cwd: ".", kind: "python", argv: ["python3", "-c", PYTHON_IDENTITY] }] },
    { family: "stestr", toolchain: "python", module: "python-stestr/unit/answer.py", obligationId: "OBL-ML-STESTR",
      commands: [{ role: "python", cwd: "python-stestr", argv: ["python3", "-m", "stestr",
        "--repo-url", "/tmp", "run", "--serial", "unit.test_answer.AnswerTests.test_returns_42"] }],
      identities: [{ role: "python", cwd: "python-stestr", kind: "python",
        argv: ["python3", "-c", PYTHON_IDENTITY] }] },
    { family: "go-test", toolchain: "go", module: "go/calc/answer.go", obligationId: "OBL-ML-GO",
      commands: [
        { role: "go", cwd: "go", argv: ["go", "test", "-count=1", "-run", "^TestAnswer$", "./calc"] },
        { role: "gofmt", cwd: "go", argv: ["gofmt", "-l", "calc/answer.go"] }],
      identities: [
        { role: "go", cwd: "go", kind: "self", argv: ["go", "env", "GOROOT"] },
        { role: "gofmt", cwd: "go", kind: "proc_exe", argv: ["gofmt"] }] },
    { family: "go-test", toolchain: "go", module: "billing/calc/answer.go", obligationId: "OBL-ML-BILLING",
      verifyArguments: { environment: "go_modules@billing" },
      commands: [
        { role: "go", cwd: "billing", argv: ["go", "test", "-count=1", "-run", "^TestAnswer$", "./calc"] }],
      identities: [{ role: "go", cwd: "billing", kind: "self", argv: ["go", "env", "GOROOT"] }] }
  ].map((row) => Object.freeze({
    ...row,
    commands: Object.freeze(row.commands.map((command) => Object.freeze({
      ...command, argv: Object.freeze([...command.argv]) }))),
    identities: Object.freeze(row.identities.map((probe) => Object.freeze({
      ...probe, argv: Object.freeze([...probe.argv]) })))
  }))),
  recoveryProbes: Object.freeze([
    Object.freeze({ command: "python3", cwd: "/tmp", argv: Object.freeze(["python3", "-c", "print('ran')"]) })
  ]),
  projections: Object.freeze(["web/node_modules"]),
  refusals: Object.freeze([
    Object.freeze({ label: "billing_in_other_go_module",
      arguments: Object.freeze({ subject: "OBL-ML-BILLING", environment: "go_modules@go" }) }),
    Object.freeze({ label: "slice_population_in_one_npm_environment",
      arguments: Object.freeze({ subject: "<selected-unit>", environment: "npm@web" }) }),
    Object.freeze({ label: "unknown_environment",
      arguments: Object.freeze({ subject: "OBL-ML-GO", environment: "npm@nowhere" }) })
  ])
});

const FIXED_PROGRAM_PLANS = Object.freeze({
  matrix: () => ({ matrix: CONNECTED_EXECUTABLE_MATRIX, recoveryProbes: CONNECTED_EXECUTABLE_RECOVERY_PROBES,
    projections: ["javascript/node_modules"], refusals: [], scenario: "matrix",
    schema: "connected-executable-matrix-receipt.v1" }),
  multilingual: () => ({ matrix: CONNECTED_MULTILINGUAL_JOURNEY.rows,
    recoveryProbes: CONNECTED_MULTILINGUAL_JOURNEY.recoveryProbes,
    projections: CONNECTED_MULTILINGUAL_JOURNEY.projections, refusals: CONNECTED_MULTILINGUAL_JOURNEY.refusals,
    scenario: "multilingual", schema: "connected-multilingual-environment-receipt.v1" }),

  runtime_preparation: () => ({ matrix: CONNECTED_EXECUTABLE_MATRIX.filter((row) => row.family === "node-test"),
    recoveryProbes: [], projections: [], refusals: [], scenario: "runtime_preparation",
    schema: "connected-runtime-preparation-receipt.v1" })
});

const CONNECTED_DELIVERY_WITNESS_SCENARIOS = new Set(["selected", "unselected", "timeout", "matrix",
  "multilingual", "observation_delivery"]);

export function buildConnectedDeliveryWitnessCodexExecutorTestSeams({ scenario }) {
  if (!CONNECTED_DELIVERY_WITNESS_SCENARIOS.has(scenario) && !Object.hasOwn(FIXED_PROGRAM_PLANS, scenario)) {
    throw new TypeError("connected delivery witness scenario must be selected, unselected, " +
      "timeout, matrix, multilingual or observation_delivery");
  }
  const seams = Object.freeze({
    spawn: (plan, stdioOptions = {}) => {
      const fixedPlan = FIXED_PROGRAM_PLANS[scenario] ?? null;
      const { prompt, childArgs, bwrapArgs, probePlan } = substituteFixedProbeCommand(plan, {
        family: "codex",
        label: "connected delivery witness",
        programSource: fixedPlan !== null ? CONNECTED_EXECUTABLE_MATRIX_SOURCE : CONNECTED_DELIVERY_WITNESS_SOURCE,
        programArgs: ({ prompt: assignment, finalPath }) => [
          finalPath, Buffer.from(assignment, "utf8").toString("base64"),
          fixedPlan !== null ? Buffer.from(JSON.stringify(fixedPlan()), "utf8").toString("base64")
            : scenario]
      });
      dispatchCodexTestSeamEvidence.push(Object.freeze({
        kind: "connected_delivery_witness",
        scenario,
        repo: plan.repo,
        cwd: plan.cwd,
        assignment_sha256: `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
        bwrap_argv_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bwrapArgs)).digest("hex")}`,
        has_conduit_projection: bwrapArgs.includes("/run/agent-launch/mcp.sock"),
        executable: process.execPath,
        wiki_mcp_child_env: captureDispatchCodexTestWikiChildEnv(childArgs)
      }));
      return spawnIsolated(probePlan, stdioOptions);
    }
  });
  connectedDeliveryWitnessCodexExecutorTestSeams.add(seams);
  return seams;
}

function createCodexExecutorTestSeamChild(finalPath, { releaseSignalPath = null } = {}) {

  const source = [
    "const fs = require('node:fs');",
    "const target = process.argv[1];",
    "if (target) fs.writeFileSync(target, 'WK-2405 advisory text from the deterministic process boundary.\\n');",
    "process.stdin.resume();",
    "const release = process.argv[2];",
    "if (release) { const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); process.exit(0); } }, 25); }"
  ].join("");
  const child = spawn(process.execPath, ["-e", source, finalPath ?? "", releaseSignalPath ?? ""], {
    stdio: ["pipe", "ignore", "ignore"]
  });
  const terminal = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", reject);
  });
  return { process: child, terminal };
}

export function createAcceptThenSucceedTestExecutor() {

  return (input) => {
    let probeCallCount = 0;
    return {
      accepted: true,
      status: "launching",
      probe() {
        probeCallCount += 1;
        if (probeCallCount === 1) {
          return { status: "running" };
        }
        return {
          status: "succeeded",
          exit: { code: 0, signal: null, error: null }
        };
      },

      __test_observed: {
        caller_session_id: input?.caller_session_id ?? null,
        role: input?.role ?? null,
        subject: input?.subject ?? null
      }
    };
  };
}

export function createAcceptStayRunningTestExecutor() {
  return () => ({
    accepted: true,
    status: "launching",
    probe() {
      return { status: "running" };
    }
  });
}

export function createRefusingTestExecutor() {
  return () => ({
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: "test_fixture_executor_refused",
      detail: { fixture: "executor_refuses" }
    }
  });
}

export function createThrowingTestExecutor() {
  return () => {
    throw new Error("test fixture executor threw");
  };
}
