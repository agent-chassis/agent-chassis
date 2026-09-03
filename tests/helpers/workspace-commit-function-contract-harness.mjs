

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { WORKER_COMMIT_TOOL_NAME } from "../../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";

export const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
export const SERVER_SOURCE = path.join(REPO_ROOT, "packages/wiki-mcp/src/server.mjs");
export const COMMIT_TOOL_SOURCE = path.join(REPO_ROOT, "packages/wiki-mcp/src/lib/workspace-commit-tool.mjs");
export const COMMIT_GUARD_SOURCE = path.join(
  REPO_ROOT,
  "packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs"
);

export const EXACT_SLICE_COMMIT_BINDING_SOURCE = path.join(
  REPO_ROOT,
  "packages/agent-launch-cli/src/lib/exact-slice-commit-binding.mjs"
);
export const SLICE_REVIEW_ACCEPTANCE_OPERATION_SOURCE = path.join(
  REPO_ROOT,
  "packages/wiki-core/src/operations/work-record-slice-review-acceptance.mjs"
);
export const TOOL_NAME = WORKER_COMMIT_TOOL_NAME;
export const ASSIGNED_UNIT = "WK-1429#SLICE-004";
export const WORKSPACE_DIR = "/repo";
export const WORKSPACE_REPO = "agent-chassis/agent-chassis";
export const BASE_SHA = "b".repeat(40);
export const COMMIT_SHA = "c".repeat(40);
export const TREE_SHA = "7".repeat(40);

function fakeZodNode() {
  const node = {};
  for (const name of ["strict", "refine", "optional", "nullable", "default", "int", "positive", "max", "min"]) {
    node[name] = () => node;
  }
  return node;
}

function buildStubModuleSource() {
  return `
const zNode = (${fakeZodNode.toString()})();
const getState = () => globalThis.__WK1429_COMMIT_CONTRACT_TEST_STATE__;

export const z = {
  object: () => zNode,
  string: () => zNode,
  number: () => zNode,
  boolean: () => zNode,
  array: () => zNode,
  record: () => zNode,
  union: () => zNode,
  unknown: () => zNode,
  any: () => zNode,
  literal: () => zNode,
  enum: () => zNode
};

export class McpServer {}
export class StdioServerTransport {}
export const WORK_RECORD_STATUS_VALUES = ["todo", "doing", "review", "done"];
export const WORK_RECORD_CONTRACT_LIST_FIELDS = [];
export const WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME = "workspace_work_record_refresh_admission_metrics";
export const WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME = "workspace_work_record_refresh_target_resolution_evidence";
export const WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME = "workspace_work_record_cleanup_derived_evidence";

export function readContractFile() { return ""; }
export function parseWorkspaceRepos() {
  return [{ repo: ${JSON.stringify(WORKSPACE_REPO)}, dir: ${JSON.stringify(WORKSPACE_DIR)} }];
}
export function resolveWorkspaceRepo(workspaceRepos) { return workspaceRepos[0]; }
export function shapeWriteResponse(_workspaceRepo, result) { return result; }
export function createCompactWorkRecordEditResponse(_workspaceRepo, result) {
  return {
    valid: Boolean(result?.valid),
    written: Boolean(result?.written),
    no_op: Boolean(result?.no_op),
    result
  };
}
export function createCompactContractEditResponse(_workspaceRepo, result) { return result; }
export function createCompactValidateDispatchResponse(_workspaceRepo, result) { return result; }
export function validateOptionalExpectedSourceDigest() { return true; }
export function runWorkspaceWorkRecordAdmissionRefreshRoute() { return {}; }
export function runWorkspaceWorkRecordCleanupDerivedEvidenceRoute() { return {}; }
export function jsonContent(value) {
  return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
}
export function errorContent(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error?.message ?? String(error) }]
  };
}
export function guardToolHandler(handler) { return handler; }
// The extracted server composition constructs these process-lifecycle helpers at
// module load. This harness strips every production import, so keep inert fakes
// here just as it does for the neighboring process-error guard. The commit
// contract never exercises server shutdown, and importing the real controller
// would install process listeners and a liveness interval in every fixture.
export function createDiagnosticSink() {
  return {
    emit() { return false; },
    disable() {},
    state: "active",
    disabled: false
  };
}
export function createStdioShutdownController() {
  return {
    phase: "running",
    requestShutdown() {},
    setServerCloseHook() {}
  };
}
export function installProcessErrorGuards() {}
export function readSpilledMcpContentReference() { return {}; }
export function parseToolProfile() { return "full"; }
export function shouldExposeTool() { return true; }
export function resolveRegisteredTier() { return "paid_cce"; }
// WK-1721: the registerTool closure moved out of server.mjs into
// ./lib/register-tool.mjs (createRegisterTool factory). This harness rebuilds
// server.mjs by stripping every import and re-injecting these stubs, so the
// factory is stubbed here with the SAME registration logic it had inline: the
// exposure gate, the two registered-tier gates, audit wrapping, guardToolHandler,
// and registeredToolNames.add — driven by the stub shouldExposeTool/guardToolHandler
// above. Behavior is identical to the pre-extraction inline closure.
export function createRegisterTool({
  server,
  toolProfile,
  registeredTier,
  mcpToolTierRegistrationPolicy,
  toolUsageAuditBoundary,
  registeredToolNames,
  structuredLog
}) {
  return function registerTool(name, config, handler) {
    if (!shouldExposeTool(toolProfile, name)) {
      return;
    }
    if (!mcpToolTierRegistrationPolicy.descriptorToolNames?.has(name)) {
      throw new Error("agent_tool_descriptor_missing: " + name);
    }
    if (!mcpToolTierRegistrationPolicy.registrationEligibleToolNames?.has(name)) {
      throw new Error("agent_tool_conformance_missing: " + name);
    }
    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.descriptorLoaded === true &&
      !mcpToolTierRegistrationPolicy.freeLocalToolNames?.has(name)
    ) {
      return;
    }
    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames instanceof Set &&
      !mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames.has(name)
    ) {
      return;
    }
    const auditedHandler = toolUsageAuditBoundary.wrapHandler(name, handler);
    server.registerTool(name, config, guardToolHandler(auditedHandler, { name, log: structuredLog }));
    registeredToolNames.add(name);
  };
}
export function loadToolDiscoveryDescriptor() { return { tools: [] }; }
export function resolveToolTierVisibility() { return ["free_local"]; }
export function workspaceToolRouterRecommend() { return {}; }
// The composition root's file-local helper run moved out of server.mjs into
// ./lib/server-composition-helpers.mjs. This harness rebuilds server.mjs by
// stripping every import and re-injecting these stubs, so the helpers it now
// imports are stubbed here. structuredLog and the audit-context builders feed
// stubbed sinks (createRegisterTool / createToolUsageAuditBoundaryRecorder);
// trimmed, augmentWorkspaceToolDiscoveryDescriptor, and
// loadMcpToolTierRegistrationPolicy keep the SAME behavior the inline versions
// had against these stubs — an empty descriptor corpus yields a loaded policy
// with no free/local names, which the paid_cce stub tier never consults.
export function structuredLog() {}
export function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
export function augmentWorkspaceToolDiscoveryDescriptor(descriptor) { return descriptor; }
export function loadMcpToolTierRegistrationPolicy() {
  const names = new Set(["commit"]);
  return {
    descriptorLoaded: true,
    descriptorToolNames: names,
    registrationEligibleToolNames: names,
    freeLocalToolNames: names,
    freeLocalFallbackToolNames: null
  };
}
export function createProductionToolUsageAuditOrigin() { return {}; }
export function createProductionToolUsageAuditSelectedContext() { return {}; }
// The four single-route registration clusters that moved out of server.mjs.
// This harness exercises the COMMIT surface, so they are stubbed exactly like
// every other registrar above.
export function registerMcpContentReferenceTools() {}
export function registerToolRouterTools() {}
export function registerInitiativeStatusTools() {}
export function registerSubmitForReviewTools() {}
export function createGraphImpactToolResponse(value) { return value; }
export function registerCodeIndexTools() {}
export function registerGraphImpactPersistenceTools() {}
export function registerStaticResources() {}
export function registerWorkRecordReadTools() {}
export function registerIntegrationStatusTools() {}
export function registerIntegrationPromoteCheckTools() {}
export function registerAgentFaqTools() {}
export function registerAuthoringErgonomicsTools() {}
export async function bindPackageDocsCarrier() { return null; }
export function registerToolDocReadTools() {}
export function toDocumentationProjectionCarrier() { return null; }
export function createToolUsageAuditBoundaryRecorder() {
  return { wrapHandler: (_name, handler) => handler, recorder: {} };
}
export function registerToolUsageAuditTools() {}
export function registerToolDiscoveryTools() {}
export function registerControlledContractTools() {}
export function persistControlledContractGeneration() {}
export function resolveControlledContractGenerationBinding() {}
export function registerWikiCoreTools() {}
export function registerWorkRecordWriteTools() {}
export function registerKindRecordWriteTools() {}
export function registerDispatchTools() {}
export function registerReviewResultEvidenceTools() {}
export function registerFrozenReviewContractTools() {}
// WK-1990: the launcher-owned managed-worker declared-test capability. This
// harness exercises the COMMIT surface, so the sibling worker route is stubbed
// exactly like every other registrar; its own contract is covered by
// tests/integration/worker-declared-test-capability.test.mjs.
export function registerWorkerDeclaredTestTool() {}
export function buildDispatchRuntime() {
  return { dispatchBackend: null, dispatchSessionIdentity: "test-session" };
}
export function bootstrapWikiMcpNodeEngineEnv() { return { loaded: false }; }
export function deriveWritableMountsFromWriteScope({ workspaceDir, writeScope }) {
  return {
    writableFiles: (writeScope ?? []).filter((entry) => !entry.endsWith("/**")).map((entry) => workspaceDir + "/" + entry),
    writableRoots: (writeScope ?? []).filter((entry) => entry.endsWith("/**")).map((entry) => workspaceDir + "/" + entry.slice(0, -3))
  };
}
export function resolveWorktreeBinding(args) {
  const state = getState();
  state.calls.push({ op: "resolve_binding", args });
  return state.binding;
}
export function materializeCommitObject(args) {
  const state = getState();
  state.calls.push({ op: "materialize", args });
  return state.materialized;
}
export function verifyAndMeasureCommitScope(args) {
  const state = getState();
  state.calls.push({ op: "verify_measure", args });
  return state.scope;
}
export function advanceWkRef(args) {
  const state = getState();
  state.calls.push({ op: "advance_ref", args });
  return state.advanced;
}
export function commitSliceRef(args) {
  const state = getState();
  state.calls.push({ op: "commit_slice_ref", args });
  if (state.publicationError) throw state.publicationError;
  return state.advanced;
}
export function compensateCommittedSliceRef(args) {
  const state = getState();
  state.calls.push({ op: "compensate_slice_ref", args });
  if (state.compensationError) throw state.compensationError;
  return state.compensationResult;
}
export async function setWorkRecordStatusByUnit(args) {
  const state = getState();
  state.calls.push({ op: "transition", args });
  if (state.transitionError) throw state.transitionError;
  return state.transitionResult;
}
`;
}

async function importServerWithFakes(t) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wk1429-commit-contract-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const stubsPath = path.join(tempDir, "stubs.mjs");
  const initiativeStatusPath = path.join(tempDir, "initiative-status.mjs");
  const commitToolPath = path.join(tempDir, "workspace-commit-tool-under-test.mjs");
  const serverPath = path.join(tempDir, "server-under-test.mjs");

  await writeFile(stubsPath, buildStubModuleSource(), "utf8");
  await writeFile(initiativeStatusPath, "export function workspace_initiative_status() { return {}; }\n", "utf8");

  const importNames = [
    "McpServer",
    "StdioServerTransport",
    "z",
    "readContractFile",
    "setWorkRecordStatusByUnit",
    "WORK_RECORD_STATUS_VALUES",
    "WORK_RECORD_CONTRACT_LIST_FIELDS",
    "parseWorkspaceRepos",
    "resolveWorkspaceRepo",
    "advanceWkRef",
    "materializeCommitObject",
    "verifyAndMeasureCommitScope",
    "resolveWorktreeBinding",
    "deriveWritableMountsFromWriteScope",
    "jsonContent",
    "errorContent",
    "guardToolHandler",
    "createDiagnosticSink",
    "createStdioShutdownController",
    "installProcessErrorGuards",
    "readSpilledMcpContentReference",
    "parseToolProfile",
    "shouldExposeTool",
    "resolveRegisteredTier",
    "createRegisterTool",
    "loadToolDiscoveryDescriptor",
    "resolveToolTierVisibility",
    "workspaceToolRouterRecommend",
    "structuredLog",
    "trimmed",
    "augmentWorkspaceToolDiscoveryDescriptor",
    "loadMcpToolTierRegistrationPolicy",
    "createProductionToolUsageAuditOrigin",
    "createProductionToolUsageAuditSelectedContext",
    "registerMcpContentReferenceTools",
    "registerToolRouterTools",
    "registerInitiativeStatusTools",
    "registerSubmitForReviewTools",
    "shapeWriteResponse",
    "createCompactWorkRecordEditResponse",
    "createCompactContractEditResponse",
    "createCompactValidateDispatchResponse",
    "validateOptionalExpectedSourceDigest",
    "runWorkspaceWorkRecordAdmissionRefreshRoute",
    "runWorkspaceWorkRecordCleanupDerivedEvidenceRoute",
    "WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME",
    "WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME",
    "WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME",
    "createGraphImpactToolResponse",
    "registerCodeIndexTools",
    "registerGraphImpactPersistenceTools",
    "registerStaticResources",
    "registerWorkRecordReadTools",
    "registerIntegrationStatusTools",
    "registerIntegrationPromoteCheckTools",
    "registerAgentFaqTools",
    "registerAuthoringErgonomicsTools",
    "bindPackageDocsCarrier",
    "registerToolDocReadTools",
    "toDocumentationProjectionCarrier",
    "createToolUsageAuditBoundaryRecorder",
    "registerToolUsageAuditTools",
    "registerToolDiscoveryTools",
    "registerControlledContractTools",
    "persistControlledContractGeneration",
    "resolveControlledContractGenerationBinding",
    "registerWikiCoreTools",
    "registerWorkRecordWriteTools",
    "registerKindRecordWriteTools",
    "registerDispatchTools",
    "registerReviewResultEvidenceTools",
    "registerFrozenReviewContractTools",
    "registerWorkerDeclaredTestTool",
    "buildDispatchRuntime",
    "bootstrapWikiMcpNodeEngineEnv"
  ];

  const commitToolOriginal = await readFile(COMMIT_TOOL_SOURCE, "utf8");
  const commitToolWithoutStaticImports = commitToolOriginal.replace(/^import[\s\S]*?;\n/gm, "");
  const commitToolTransformed = [
    'import path from "node:path";',
    `import { resolveLauncherRunCredential, resolveAssignedUnit, WIKI_MCP_ASSIGNED_UNIT_ENV_VAR, WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR, WIKI_MCP_COMMIT_RUN_ID_ENV_VAR } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, "packages/wiki-mcp/src/lib/launcher-run-credential.mjs")).href)};`,
    `import { advanceWkRef, materializeCommitObject, verifyAndMeasureCommitScope, resolveWorktreeBinding, deriveWritableMountsFromWriteScope } from ${JSON.stringify(pathToFileURL(stubsPath).href)};`,
    `import { admitWorkerCommitCall, WORKER_COMMIT_TOOL_NAME } from ${JSON.stringify(pathToFileURL(COMMIT_GUARD_SOURCE).href)};`,
    'import { verifyExactSliceCommitBinding, resolveCommitGitIdentity, normalizeCommitRef, ' +
      'resolveExpectedEnvelope, resolveSparseBinding, resolveCommitWriteScopeMatcher } from ' +
      `${JSON.stringify(pathToFileURL(EXACT_SLICE_COMMIT_BINDING_SOURCE).href)};`,
    `import { persistExactSliceImplementationReviewTransition } from ${JSON.stringify(pathToFileURL(SLICE_REVIEW_ACCEPTANCE_OPERATION_SOURCE).href)};`,
    commitToolWithoutStaticImports
  ].join("\n").replace(
    'import("../../../agent-launch-cli/src/lib/slice-integration.mjs")',
    `import(${JSON.stringify(pathToFileURL(stubsPath).href)})`
  );
  await writeFile(commitToolPath, commitToolTransformed, "utf8");

  const original = (await readFile(SERVER_SOURCE, "utf8")).replace(/^#!.*\n/u, "");
  const withoutStaticImports = original.replace(/^import[\s\S]*?;\n/gm, "");
  const withoutMain = withoutStaticImports.replace(
    /\n(?:main\(\)\.catch|if \(process\.argv\[1\][^\n]*\))[\s\S]*$/u,
    "\nexport { registerTools };\n"
  );
  const transformed = [
    `import { ${importNames.join(", ")} } from ${JSON.stringify(pathToFileURL(stubsPath).href)};`,
    `import { registerWorkspaceCommitTool, WORKER_COMMIT_TOOL_NAME } from ${JSON.stringify(pathToFileURL(commitToolPath).href)};`,
    withoutMain.replace(
      'await import("../../wiki-core/src/operations/initiative-status.mjs")',
      `await import(${JSON.stringify(pathToFileURL(initiativeStatusPath).href)})`
    )
  ].join("\n");
  await writeFile(serverPath, transformed, "utf8");
  return import(pathToFileURL(serverPath).href);
}

export async function registerCommitTool(t) {
  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { name, config, handler });
    }
  };
  const module = await importServerWithFakes(t);
  await module.registerTools(server);
  const tool = tools.get(TOOL_NAME);
  assert.ok(tool, "commit tool must be registered");
  return tool;
}

export function exactSliceBinding(overrides = {}) {
  return {
    schema_version: "worktree-identity-binding.v1",
    launch_ref: "launch-WK-1429-SLICE-004",
    run_id: "wkdb_WK1429_SLICE004",
    retry_id: 0,
    unit_address: "IN-0011/WK-1429/SLICE-004",
    initiative: "IN-0011",
    record_id: "WK-1429",
    slice_id: "SLICE-004",

    base_ref: "wk/IN-0011/WK-1429",
    base_sha: BASE_SHA,
    output_branch: "slice/IN-0011/WK-1429/SLICE-004",
    worktree_path: "/worktrees/slice-IN-0011-WK-1429-SLICE-004",
    read_scope: ["docs"],
    repo_paths: ["packages/wiki-mcp"],
    write_scope: ["tests/unit/workspace-commit-function-contract.test.mjs"],
    write_scope_source: "wiki/work-records/WK-1429.json#SLICE-004",
    selected_unit: {
      kind: "slice",
      address: ASSIGNED_UNIT,
      record_id: "WK-1429",
      slice_id: "SLICE-004",
      repo: WORKSPACE_REPO
    },
    source_digest: `sha256:${"a".repeat(64)}`,
    source_version: "1",
    cone_dirs: ["packages/wiki-mcp", "tests"],
    index_sparse: false,
    ...overrides
  };
}

export function exactFullSliceBinding(overrides = {}) {
  const binding = exactSliceBinding({ output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004" });
  delete binding.cone_dirs;
  delete binding.index_sparse;
  binding.schema_version = "worktree-identity-binding.v2";
  binding.checkout_mode = "full";
  return { ...binding, ...overrides };
}

export function saveCommitEnv(t) {
  const previous = {
    WIKI_MCP_ASSIGNED_UNIT: process.env.WIKI_MCP_ASSIGNED_UNIT,
    WIKI_MCP_COMMIT_BINDING: process.env.WIKI_MCP_COMMIT_BINDING,
    WIKI_MCP_COMMIT_LAUNCH_REF: process.env.WIKI_MCP_COMMIT_LAUNCH_REF,
    WIKI_MCP_COMMIT_RUN_ID: process.env.WIKI_MCP_COMMIT_RUN_ID,
    WIKI_MCP_COMMIT_RETRY_ID: process.env.WIKI_MCP_COMMIT_RETRY_ID,
    WIKI_MCP_TOOL_PROFILE: process.env.WIKI_MCP_TOOL_PROFILE
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export function installIdentityStoreEnv(t, binding = exactSliceBinding(), assignedUnit = ASSIGNED_UNIT) {
  saveCommitEnv(t);
  process.env.WIKI_MCP_ASSIGNED_UNIT = assignedUnit;
  delete process.env.WIKI_MCP_COMMIT_BINDING;
  process.env.WIKI_MCP_COMMIT_LAUNCH_REF = binding.launch_ref;
  process.env.WIKI_MCP_COMMIT_RUN_ID = binding.run_id;
  process.env.WIKI_MCP_COMMIT_RETRY_ID = String(binding.retry_id);
  process.env.WIKI_MCP_TOOL_PROFILE = "full";
}

export function installState(overrides = {}) {
  const state = {
    calls: [],
    binding: exactSliceBinding(),
    materialized: { base_sha: BASE_SHA, commit: COMMIT_SHA, tree: TREE_SHA },
    scope: {
      contained: true,
      changed_paths: ["tests/unit/workspace-commit-function-contract.test.mjs"],
      metrics: {
        measured: true,
        changed_line_count: { added: 12, deleted: 2, total: 14, binary_paths: [] },
        final_file_sizes: { "tests/unit/workspace-commit-function-contract.test.mjs": 4200 },
        changed_file_count: 1,
        scope_count: 1
      },
      baseline: {
        measured: true,
        file_sizes_at_base: { "tests/unit/workspace-commit-function-contract.test.mjs": 0 }
      },
      attestation: {
        schema_version: "envelope-attestation-marker.v1",
        state: "not_attested",
        reason: "free_tier"
      },
      expected_envelope_invariant: {
        checked: true,
        ok: true,
        blocking: false
      },
      refusal: null
    },
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/wk/IN-0011/WK-1429",
      prior_tip: BASE_SHA,
      idempotent: false,
      ref_advanced: true,
      empty_delivery: false
    },
    compensationResult: {
      compensated: true,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      published_commit: COMMIT_SHA,
      restored_tip: BASE_SHA
    },
    compensationError: null,
    publicationError: null,
    transitionError: null,
    transitionResult: {
      valid: true,
      written: true,
      no_op: false,
      record_id: "WK-1429",
      selected_unit: {
        kind: "slice",
        address: ASSIGNED_UNIT,
        record_id: "WK-1429",
        slice_id: "SLICE-004",
        repo: WORKSPACE_REPO
      },
      status: "review"
    },
    ...overrides
  };
  globalThis.__WK1429_COMMIT_CONTRACT_TEST_STATE__ = state;
  return state;
}

export function publishedExactSliceAdvance(overrides = {}) {
  return {
    base_sha: BASE_SHA,
    commit: COMMIT_SHA,
    tree: TREE_SHA,
    ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
    prior_tip: BASE_SHA,
    idempotent: false,
    ref_advanced: true,
    empty_delivery: false,
    ...overrides
  };
}

export function installRequestTuple(t, { launchRef, runId, retryId }, assignedUnit = ASSIGNED_UNIT) {
  saveCommitEnv(t);
  process.env.WIKI_MCP_ASSIGNED_UNIT = assignedUnit;
  delete process.env.WIKI_MCP_COMMIT_BINDING;
  process.env.WIKI_MCP_COMMIT_LAUNCH_REF = launchRef;
  process.env.WIKI_MCP_COMMIT_RUN_ID = runId;
  process.env.WIKI_MCP_COMMIT_RETRY_ID = String(retryId);
  process.env.WIKI_MCP_TOOL_PROFILE = "full";
}

export async function assertCommitFailsClosedBeforeGit(t, binding, label, { requestTuple = null } = {}) {
  if (requestTuple === null) {
    installIdentityStoreEnv(t, binding);
  } else {
    installRequestTuple(t, requestTuple);
  }
  const state = installState({ binding });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.isError, true, `${label} must fail closed`);
  assert.match(result.content[0].text, /credential->binding resolver threw/);
  assert.deepEqual(
    state.calls.map((call) => call.op),
    ["resolve_binding"],
    `${label} must be refused before materialization, scope measurement, ref advance, or transition`
  );
}
