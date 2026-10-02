

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { computeWorkRecordSourceDigest } from "../../../wiki-core/src/lib/work-record-schema.mjs";
import { projectWorkRecordFreshness } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  runWithControlledContractAuthorityContext,
  withControlledContractAuthorityExclusion
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

import {
  WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_RESULT_KINDS,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES,
  WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_POLICY_POSTURES
} from "./trusted-operation-contracts.mjs";
import {
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalWkCandidateVersion,
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import {
  authenticateCurrentControlledContractGenerationAtW,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES,
  ControlledContractGenerationPersistenceError
} from "./controlled-carrier-attachment-primitive.mjs";
import {
  assertTerminalCandidateMaterialization,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  TerminalReviewMaterializationError,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import { authenticateWkCloseoutProjection } from "./wk-forge-handoff-recovery.mjs";
import { resolveCapturedWkBase } from "./worktree-substrate-identity.mjs";
import { authenticateCanonicalIntegratedDeliveryTransition } from
  "./backend-integrated-scope-authority.mjs";
import { captureDiagnosticEvidence, DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION } from "./diagnostic-evidence.mjs";
import {
  git,
  HANDOFF_TRANSPORTS,
  isAncestor,
  listRecordedHandoffs,
  observeLandingBaseTip,
  observeRemoteRef,
  publishRemoteRef,
  readLocalRef,
  resolveHandoffDestination,
  resolveRemoteUrl,
  updateLocalRef,
  wkHandoffRef
} from "./wk-handoff-destination.mjs";
import { withWorkRecordWriteLock } from "@agent-chassis/wiki-core/src/operations/work-record-write-lock.mjs";
import { isCanonicalWorkRecordBaseBranch } from
  "@agent-chassis/wiki-core/src/lib/work-record-base-branch.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

export { WK_FORGE_HANDOFF_FAILURE_CATEGORIES };

export const FORGE_LANDING_BRANCH_ENV_VAR = "AGENT_LAUNCH_FORGE_LANDING_BRANCH";

const authenticatedHandoffResults = new WeakMap();

export function assertAuthenticatedWkForgeHandoffResult(result) {
  const retained = authenticatedHandoffResults.get(result);
  if (retained === undefined) {
    throw new Error("WK forge handoff result is not launcher-authenticated");
  }
  return retained;
}

export const PULL_REQUEST_PAGE_LIMIT = 20;
export const PULL_REQUEST_PAGE_SIZE = 100;
export const PULL_REQUEST_URL_MAX_LENGTH = 2048;

const WK_FORGE_HANDOFF_TOOL = "workspace_wk_forge_handoff";

const LIVE_RECORD_PUBLISHED_FACT = "forge_handoff.live_record_published";

const WK_RECORD_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FORGE_HOST_RE = /^[a-z0-9.-]+$/u;
const FORGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;
const PULL_REQUEST_STATES = new Set(["open", "closed"]);
const PULL_REQUEST_MERGEABLE_STATES = new Set([
  "clean", "dirty", "unstable", "blocked", "behind", "has_hooks", "unknown", "draft"
]);
const PULL_REQUEST_URL_SECRET_SHAPE_RE =
  /(?:github_pat_|gh[pousr]_|x-access-token|(?:access[_-]?token|api[_-]?key|authorization|bearer|password|passwd|secret|credential)[=:@/])/iu;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DESTINATION_CONFIGURATION_PREREQUISITE =
  "the main repository's Git configuration selects exactly one valid handoff destination";
const REMOTE_CONFIGURATION_PREREQUISITE =
  "the selected remote has exactly one fetch and push URL, no URL rewrite, and (for hosted " +
  "handoff) a canonical https forge repository URL";
const ESTABLISHED_CORRECTIONS = Object.freeze({
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID]: Object.freeze({
    handoff_destination_unselected: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "set agent-launch.handoffDestination in the main repository to local, " +
        "git:<remote> or hosted:<remote>, or name the intended remote origin"
    }),
    handoff_destination_selector_ambiguous: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "keep exactly one agent-launch.handoffDestination value in the main repository"
    }),
    handoff_destination_selector_invalid: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "set agent-launch.handoffDestination to local, git:<remote> or hosted:<remote>"
    }),
    ...Object.fromEntries(["url_rewrite_configured", "remote_fetch_url_not_unique",
      "remote_push_url_not_unique", "remote_push_url_diverges", "remote_url_not_canonical_https"]
      .map((reason) => [reason, Object.freeze({
        responsible_actor: "operator",
        prerequisite: REMOTE_CONFIGURATION_PREREQUISITE,
        operator_action: "correct the selected remote's URL configuration in the main repository"
      })]))
  }),
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID]: Object.freeze({
    main_repo_missing: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the launcher-frozen main repository"
    })
  }),
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY]: Object.freeze({
    exact_terminal_candidate_resolver_unavailable: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the terminal-candidate publication-state resolver"
    }),
    exact_terminal_candidate_observer_unavailable: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the terminal-candidate publication-state observer"
    })
  })
});

function refuse(category, detail) {
  const key = detail?.reason ?? detail?.issue;
  const established = typeof key === "string"
    ? ESTABLISHED_CORRECTIONS[category]?.[key] ?? null
    : null;
  return {
    ok: false,
    category,
    detail: established === null ? detail ?? null : { ...detail, ...established }
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function buildForgeHandoffPolicyTarget({ binding, initiative, destination, repository, landing, branch }) {
  return Object.freeze({
    operation: "wk_forge_handoff",
    assigned_unit: binding.canonical_wk_id,
    initiative,
    candidate_sha: binding.candidate,
    candidate_tree: binding.candidate_tree,
    candidate_ref: binding.candidate_ref,
    base_ref: binding.base_ref,
    base_sha: binding.base,
    wk_ref: binding.wk_ref,
    wk_sha: binding.wk_tip,
    canonical_wk_digest: binding.canonical_wk_digest,
    destination: projectHandoffDestination(destination),
    repository: repository === null ? null : Object.freeze({
      host: repository.host,
      owner: repository.owner,
      name: repository.name
    }),
    base_branch: landing,
    handoff_branch: destination.transport === HANDOFF_TRANSPORTS.LOCAL ? null : branch
  });
}

function projectHandoffDestination(destination) {
  return Object.freeze({
    transport: destination.transport,
    ...(destination.remote === undefined ? {} : { remote: destination.remote }),
    selection: destination.selection
  });
}

export async function resolveWkForgeHandoffBoundaryAuthorization({
  policy = null,
  binding,
  initiative,
  destination,
  repository,
  landing,
  branch
} = {}) {
  const target = buildForgeHandoffPolicyTarget({
    binding, initiative, destination, repository, landing, branch
  });
  if (policy === null || (isPlainObject(policy) && policy.configured === false)) {
    return {
      ok: true,
      authorization: Object.freeze({
        schema_version: WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
        policy_posture: WK_FORGE_HANDOFF_POLICY_POSTURES.FREE_SUBSTRATE,
        authority: "none",
        configured_gate: false,
        decision: "not_gated",
        ratified: false,
        attestation_valid: false,
        audit_grade: false,
        target
      })
    };
  }
  if (!isPlainObject(policy) || policy.configured !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_configuration_malformed"
    });
  }
  if (typeof policy.authorize !== "function") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_missing"
    });
  }
  const request = Object.freeze({
    schema_version: WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION,
    target
  });
  let decision;
  try {
    decision = await policy.authorize(request);
  } catch {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_unavailable"
    });
  }
  if (decision === null || decision === undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_missing"
    });
  }
  if (!hasExactKeys(decision, [
    "schema_version", "decision_id", "decision", "ratified", "attestation_valid", "target"
  ]) || decision.schema_version !== WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION ||
      typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
      decision.decision_id.length > 256 || !new Set(["allow", "deny"]).has(decision.decision) ||
      typeof decision.ratified !== "boolean" || typeof decision.attestation_valid !== "boolean") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_malformed"
    });
  }
  if (canonicalJson(decision.target) !== canonicalJson(target)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_target_mismatch"
    });
  }
  if (decision.ratified !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_unratified"
    });
  }
  if (decision.attestation_valid !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_attestation_invalid"
    });
  }
  if (decision.decision !== "allow") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_denied",
      decision_id: decision.decision_id
    });
  }
  return {
    ok: true,
    authorization: Object.freeze({
      schema_version: WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
      policy_posture: WK_FORGE_HANDOFF_POLICY_POSTURES.CCE_POLICY,
      authority: "cce",
      configured_gate: true,
      decision: "allow",
      decision_id: decision.decision_id,
      ratified: true,
      attestation_valid: true,
      audit_grade: true,
      target
    })
  };
}

export function defaultRunGit({ repo, args, env = null }) {
  const argv = ["git", "-C", repo, "-c", "core.quotePath=false", ...args];
  let res;
  try {
    res = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      env: env === null ? process.env : env,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err), native: { argv, error: err } };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error), native: { argv, result: res } };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",

      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null,
      native: { argv, result: res }
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

export function defaultRunGh({ args, cwd = null }) {
  const argv = ["gh", ...args];
  let res;
  try {
    res = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      cwd: cwd ?? undefined,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    return { ok: false, argv, status: null, signal: null, stdout: null, stderr: null, spawn_error: error };
  }
  const outcome = {
    ok: res.status === 0 && res.error === undefined,
    argv,
    status: res.status ?? null,
    signal: res.signal ?? null,
    stdout: typeof res.stdout === "string" ? res.stdout : null,
    stderr: typeof res.stderr === "string" ? res.stderr : null
  };
  if (res.error === undefined) return outcome;
  return res.error?.code === "ENOBUFS"
    ? { ...outcome, capture_failure: res.error }
    : { ...outcome, spawn_error: res.error };
}

function forgeCommandError(message, { operation, result, cause } = {}) {
  const { spawn_error: spawnError, capture_failure: captureFailure, ...facts } =
    isPlainObject(result) ? result : { result };
  const native = cause ?? spawnError ?? captureFailure;
  const error = new Error(message, native === undefined ? undefined : { cause: native });
  Object.assign(error, { operation, ...facts },
    captureFailure === undefined ? {} : { output_capture: "incomplete" });
  return error;
}

const forgeCommandEvidence = (message, details) =>
  captureDiagnosticEvidence(forgeCommandError(message, details));

export function parseHttpsForgeRepositoryUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  const host = parsed.hostname.toLowerCase();
  if (!FORGE_HOST_RE.test(host)) return null;
  const segments = parsed.pathname.replace(/^\/+/u, "").split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/u, "");
  if (!FORGE_SEGMENT_RE.test(owner) || !FORGE_SEGMENT_RE.test(name)) return null;
  return Object.freeze({ host, owner, name, https_url: `https://${host}/${owner}/${name}.git` });
}

export function resolveCanonicalForgeRepository({ repo, remoteName = "origin", deps = {} } = {}) {
  const remote = resolveRemoteUrl({ repo, remoteName, runGit: deps.runGit ?? defaultRunGit });
  if (remote.ok !== true) return remote;
  const identity = parseHttpsForgeRepositoryUrl(remote.url);
  if (identity === null) return { ok: false, reason: "remote_url_not_canonical_https" };
  return { ok: true, repository: identity };
}

export function sameForgeRepository(a, b) {
  return Boolean(a && b && a.host === b.host && a.owner === b.owner && a.name === b.name);
}

export function readCandidateBoundRecord({ mainRepo, wk, binding, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  if (binding?.canonical_wk_id !== wk || !OBJECT_ID_RE.test(binding?.candidate ?? "")) {
    return { ok: false, reason: "candidate_record_binding_invalid" };
  }
  let raw;
  try {
    raw = git(runGit, mainRepo, ["show", `${binding.candidate}:wiki/work-records/${wk}.json`]);
  } catch {
    return { ok: false, reason: "candidate_bound_record_unreadable" };
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "candidate_bound_record_unparseable" };
  }
  if (!isPlainObject(record) || record.id !== wk) {
    return { ok: false, reason: "candidate_bound_record_identity_mismatch" };
  }
  return {
    ok: true,
    record,

    record_digest: computeWorkRecordSourceDigest(record)
  };
}

function deriveForgeBranchName({ initiative, wk, candidate }) {
  return `handoff/wk/${initiative}/${wk}/${candidate}`;
}

export class WkCloseoutObservationError extends Error {
  constructor(observation, cause) {
    super(`closeout ${observation} could not be observed`, { cause });
    this.name = "WkCloseoutObservationError";
    this.observation = observation;
  }
}

export function wkCloseoutObservationDetail(error) {
  return {
    stage: "closeout",
    reason: "closeout_chain_unobservable",
    observation: error.observation,
    evidence: captureDiagnosticEvidence(error)
  };
}

async function gitStdout(runGit, repo, args) {
  const res = await runGit({ repo, args, env: null });
  if (!res || res.ok !== true) {
    const err = new Error(`git ${args[0]} failed`, { cause: res });
    err.git = { repo, args: [...args], status: res?.status ?? null, stderr: res?.stderr ?? null };
    throw err;
  }
  return String(res.stdout ?? "").trim();
}

async function observeCloseout(observation, read) {
  try {
    return await read();
  } catch (error) {
    throw new WkCloseoutObservationError(observation, error);
  }
}

async function readCommitJson(runGit, repo, commit, path) {
  const value = await observeCloseout("record", async () =>
    JSON.parse(await gitStdout(runGit, repo, ["show", `${commit}:${path}`])));
  return isPlainObject(value) ? value : null;
}

async function soleParent(runGit, repo, commit) {
  const parts = (await observeCloseout("parent", () =>
    gitStdout(runGit, repo, ["rev-list", "--parents", "-n", "1", commit]))).split(/\s+/u);
  return parts.length === 2 && parts[0] === commit && OBJECT_ID_RE.test(parts[1]) ? parts[1] : null;
}

async function isExactWkOnlyModification(runGit, repo, parent, commit, path) {
  const lines = (await observeCloseout("diff", () => gitStdout(runGit, repo, [
    "diff-tree", "--no-commit-id", "--raw", "-r", "--no-renames", parent, commit
  ]))).split("\n").filter(Boolean);
  if (lines.length !== 1) return false;
  const match = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (\w+)\t(.+)$/u.exec(lines[0]);
  return match !== null && match[1] === match[2] && match[5] === "M" && match[6] === path;
}

function sameJson(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

export function safeLocalWkPath(mainRepo, localPath) {
  let current = mainRepo;
  const relative = nodePath.relative(mainRepo, localPath).split(nodePath.sep).filter(Boolean);
  for (const part of relative) {
    current = nodePath.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("unsafe local WK path");
  }
  const stat = lstatSync(localPath);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("unsafe local WK path");
}

export function readLocalWkAtomically(localPath) {
  const fd = openSync(localPath, "r");
  try {
    const before = statSync(localPath);
    const bytes = readFileSync(fd, "utf8");
    const after = statSync(localPath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs) throw new Error("local WK changed while reading");
    return bytes;
  } finally { closeSync(fd); }
}

async function commitOnlyWk({ runGit, repo, parent, recordBytes, path, message, tempRoot }) {
  const index = nodePath.join(tempRoot, `index-${createHash("sha256").update(message).digest("hex")}`);
  const file = nodePath.join(tempRoot, `record-${createHash("sha256").update(recordBytes).digest("hex")}`);
  writeFileSync(file, recordBytes, "utf8");
  const run = async (args) => {
    const res = await runGit({ repo, args, env: { ...process.env, GIT_INDEX_FILE: index } });
    if (!res || res.ok !== true) throw new Error(`git ${args[0]} failed`);
    return String(res.stdout ?? "").trim();
  };
  await run(["read-tree", parent]);
  const blob = await run(["hash-object", "-w", "--path", path, file]);
  await run(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
  const tree = await run(["write-tree"]);
  const commit = await run(["commit-tree", tree, "-p", parent, "-m", message]);
  if (!OBJECT_ID_RE.test(commit) || await soleParent(runGit, repo, commit) !== parent ||
      !await isExactWkOnlyModification(runGit, repo, parent, commit, path)) {
    throw new Error("closeout commit changes more than the WK record");
  }
  return commit;
}

function authenticateCloseoutIntegratedDelivery({ mainRepo, wk, binding, candidateRecord, closeoutRecord }) {
  const changed = (Array.isArray(candidateRecord?.slices) ? candidateRecord.slices : [])
    .filter((before) => {
      const after = Array.isArray(closeoutRecord?.slices)
        ? closeoutRecord.slices.find((slice) => slice?.id === before?.id)
        : undefined;
      return isPlainObject(after) && typeof after.integrated_delivery_sha === "string" &&
        after.integrated_delivery_sha !== (before?.integrated_delivery_sha ?? null);
    })
    .map((before) => ({
      slice_id: before.id,
      observed: closeoutRecord.slices.find((slice) => slice?.id === before.id).integrated_delivery_sha
    }));
  if (changed.length !== 1) return { expectation: null, failure: null };
  const [{ slice_id: sliceId, observed }] = changed;
  const facts = { slice_id: sliceId, observed_integrated_delivery_sha: observed, selected_w: binding?.wk_tip ?? null };
  let proof;
  try {
    proof = authenticateCanonicalIntegratedDeliveryTransition(mainRepo, `${wk}#${sliceId}`, {
      historicalParentContract: JSON.stringify(candidateRecord)
    });
  } catch (error) {
    const owned = error?.integrated_delivery_authentication;
    return {
      expectation: null,
      failure: {
        ...facts,
        reason: typeof owned?.reason === "string" ? owned.reason : "integrated_delivery_authority_unavailable",
        ...(owned?.detail === undefined ? {} : { authority_detail: owned.detail }),
        code: typeof error?.code === "string" ? error.code : null
      }
    };
  }
  if (proof.current_w !== binding?.wk_tip) {
    return {
      expectation: null,
      failure: { ...facts, reason: "integrated_delivery_not_bound_to_selected_w", authenticated_w: proof.current_w }
    };
  }
  if (proof.integrated_delivery_sha !== observed) {
    return {
      expectation: null,
      failure: {
        ...facts,
        reason: "integrated_delivery_disagrees_with_producer_proof",
        authenticated_integrated_delivery_sha: proof.integrated_delivery_sha
      }
    };
  }
  return {
    expectation: Object.freeze({ slice_id: sliceId, integrated_delivery_sha: proof.integrated_delivery_sha }),
    failure: null
  };
}

function authenticateCloseoutRecord({
  mainRepo, wk, binding, candidateRecord, closeoutRecord, publishedRecord = null
}) {
  const delivery = authenticateCloseoutIntegratedDelivery({
    mainRepo, wk, binding, candidateRecord, closeoutRecord
  });
  const projection = authenticateWkCloseoutProjection({
    candidateRecord, liveRecord: closeoutRecord, integratedDelivery: delivery.expectation, publishedRecord
  });
  return { projection, deliveryFailure: delivery.failure };
}

function readLiveWkRecord(mainRepo, wk) {
  const localPath = nodePath.join(mainRepo, `wiki/work-records/${wk}.json`);
  try {
    safeLocalWkPath(mainRepo, localPath);
    const bytes = readLocalWkAtomically(localPath);
    const record = JSON.parse(bytes);
    return isPlainObject(record) && record.id === wk
      ? { ok: true, bytes, record }
      : { ok: false, reason: "local_WK_not_closeout_ready" };
  } catch {
    return { ok: false, reason: "local_WK_unsafe_or_unreadable" };
  }
}

export const ACCEPTANCE_VALIDATION_FIELD = "acceptance.validation";
export const ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE = Object.freeze({
  state: "guidance",
  route: "workspace_tools_describe",
  args: Object.freeze({
    tool_name: "workspace_work_record_edit",
    input_contract: Object.freeze({ kind: "field", scope: "record", field: ACCEPTANCE_VALIDATION_FIELD })
  }),
  information: "The ordinary editor's record-level acceptance.validation contract, including how to " +
    "record post-run results and limitations as a new entry without changing candidate-bound acceptance.",
  responsible_actor: "coordinator",
  prerequisite: "the live WK record's acceptance.validation equals the declaration the terminal " +
    "candidate authenticated (acceptance_validation_drift.candidate_value)",
  retry_condition: "re-issue workspace_wk_forge_handoff for the same assigned_unit after the live " +
    "acceptance.validation equals acceptance_validation_drift.candidate_value",
  explanation: "If the change was intended to record results or limitations: preserve that text in a " +
    "new workspace_work_record_entry_upsert entry (omit entry_id; expected_source_digest is the " +
    "record's current freshness, initially acceptance_validation_drift.observed_source_digest), then " +
    "replace acceptance.validation with acceptance_validation_drift.candidate_value through " +
    "workspace_work_record_edit using the freshness that entry write returned, then retry. A stale " +
    "freshness refuses, so an intervening edit is never overwritten. If the change altered a " +
    "requirement, this candidate cannot be published: an entry records evidence only, satisfies no " +
    "unmet requirement and does not cure this drift. Reading this guidance changes nothing."
});

function acceptanceValidationDrift({ wk, binding, candidateRecord, liveRecord, projection }) {
  if (projection.reason !== "unrelated_record_drift" || !Array.isArray(projection.fields) ||
      projection.fields.length !== 1 || projection.fields[0] !== ACCEPTANCE_VALIDATION_FIELD) {
    return {};
  }
  return {
    acceptance_validation_drift: Object.freeze({
      unit: wk,
      candidate: binding?.candidate ?? null,
      field: ACCEPTANCE_VALIDATION_FIELD,
      candidate_value: candidateRecord.acceptance?.validation ?? null,
      observed_value: liveRecord.acceptance?.validation ?? null,

      observed_source_digest: projectWorkRecordFreshness(computeWorkRecordSourceDigest(liveRecord)),
      cas_argument: "expected_source_digest"
    }),
    recovery: ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE
  };
}

function readAuthenticatedLiveCloseout({
  mainRepo, wk, candidateRecord, binding = null, publishedRecord = null
} = {}) {
  const live = readLiveWkRecord(mainRepo, wk);
  if (live.ok !== true) return live;
  if (live.record.status !== "review") return { ok: false, reason: "local_WK_not_closeout_ready" };
  const { projection, deliveryFailure } = authenticateCloseoutRecord({
    mainRepo, wk, binding, candidateRecord, closeoutRecord: live.record, publishedRecord
  });
  if (projection.ok !== true) {

    const { ok: _ok, ...projectionCause } = projection;
    return {
      ok: false,
      reason: "local_WK_not_authenticated_against_candidate",
      projection: projectionCause,
      ...acceptanceValidationDrift({ wk, binding, candidateRecord, liveRecord: live.record, projection }),
      ...(deliveryFailure === null ? {} : { integrated_delivery_authority: deliveryFailure })
    };
  }
  return Object.freeze({ ok: true, bytes: live.bytes, record: projection.closeoutRecord });
}

export async function prepareWkCloseoutChain({
  mainRepo, wk, candidate, candidateRecord, binding = null, deps = {}
} = {}) {
  const live = readAuthenticatedLiveCloseout({ mainRepo, wk, candidateRecord, binding });
  if (live.ok !== true) return live;
  return commitWkCloseoutChain({ mainRepo, wk, candidate, binding, live, deps });
}

async function commitWkCloseoutChain({ mainRepo, wk, candidate, binding, live, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const path = `wiki/work-records/${wk}.json`;
  const tempRoot = mkdtempSync(nodePath.join(os.tmpdir(), "wk-forge-closeout-"));
  try {
    const closeout = await commitOnlyWk({
      runGit, repo: mainRepo, parent: candidate, path, tempRoot, message: `${wk}: record closeout`,
      recordBytes: JSON.stringify(live.record, null, 2) + "\n"
    });
    const completion = await commitOnlyWk({
      runGit, repo: mainRepo, parent: closeout, path, tempRoot, message: `${wk}: complete`,
      recordBytes: JSON.stringify({ ...live.record, status: "done" }, null, 2) + "\n"
    });
    const chain = await authenticateWkCloseoutChain({
      mainRepo, wk, candidate, binding, head: completion, deps
    });
    if (chain === null || chain.completion !== completion) {
      return { ok: false, reason: "prepared_closeout_chain_unauthenticated" };
    }
    return { ok: true, head: completion, closeout };
  } catch (error) {
    if (!(error instanceof WkCloseoutObservationError)) throw error;
    return { ok: false, ...wkCloseoutObservationDetail(error) };
  } finally {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {   }
  }
}

export async function authenticateWkCloseoutChain({
  mainRepo, wk, candidate, head, binding = null, deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  if (typeof mainRepo !== "string" || !WK_RECORD_RE.test(wk ?? "") ||
      !OBJECT_ID_RE.test(candidate ?? "") || !OBJECT_ID_RE.test(head ?? "") || head === candidate) {
    return null;
  }
  const path = `wiki/work-records/${wk}.json`;
  const headParent = await soleParent(runGit, mainRepo, head);
  if (headParent === null) return null;
  const closeout = headParent === candidate ? head : headParent;
  const completion = headParent === candidate ? null : head;
  if (completion !== null && await soleParent(runGit, mainRepo, closeout) !== candidate) return null;
  if (!await isExactWkOnlyModification(runGit, mainRepo, candidate, closeout, path)) return null;
  const candidateRecord = await readCommitJson(runGit, mainRepo, candidate, path);
  const closeoutRecord = await readCommitJson(runGit, mainRepo, closeout, path);
  const { projection } = authenticateCloseoutRecord({
    mainRepo, wk, binding, candidateRecord, closeoutRecord
  });
  if (projection.ok !== true || candidateRecord.id !== wk) return null;
  if (completion === null) {
    return Object.freeze({ candidate, closeout, completion: null, head, closeoutRecord, doneRecord: null });
  }
  if (!await isExactWkOnlyModification(runGit, mainRepo, closeout, completion, path)) return null;
  const doneRecord = await readCommitJson(runGit, mainRepo, completion, path);
  if (doneRecord?.status !== "done" ||
      !sameJson({ ...doneRecord, status: closeoutRecord.status }, closeoutRecord)) return null;
  return Object.freeze({ candidate, closeout, completion, head, closeoutRecord, doneRecord });
}

export function buildGhForge({ repository, mainRepo, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const runGh = deps.runGh ?? defaultRunGh;
  const { host, owner, name, https_url: httpsUrl } = repository;
  const hostArgs = ["--hostname", host];

  return {
    repository,

    probe() {
      const operation = "probe";
      const auth = runGh({ args: ["auth", "status", ...hostArgs] });
      if (auth.spawn_error) {
        return { state: "unauthenticated", reason: "gh_absent",
          evidence: forgeCommandEvidence("gh auth status could not run", { operation, result: auth }) };
      }
      if (auth.ok !== true) {
        return { state: "unauthenticated", reason: "gh_not_authenticated_for_host",
          evidence: forgeCommandEvidence("gh auth status failed", { operation, result: auth }) };
      }
      const repoRes = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}`] });
      if (repoRes.spawn_error || repoRes.ok !== true) {
        return { state: "error", reason: "exact_repository_access_unproven",
          evidence: forgeCommandEvidence("gh repository read failed", { operation, result: repoRes }) };
      }
      let body;
      try {
        body = JSON.parse(repoRes.stdout);
      } catch (error) {
        return { state: "error", reason: "repository_api_response_unparseable",
          evidence: forgeCommandEvidence("gh repository response could not be parsed",
            { operation, result: repoRes, cause: error }) };
      }

      if (typeof body.full_name === "string" && body.full_name !== `${owner}/${name}`) {
        return { state: "error", reason: "repository_identity_mismatch" };
      }
      return { state: "authenticated" };
    },

    observeRemoteBranch({ branch }) {
      const operation = "observe_remote_branch";
      const res = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/git/ref/heads/${branch}`] });
      if (res.spawn_error) {
        return { kind: "unprovable",
          evidence: forgeCommandEvidence("gh branch read could not run", { operation, result: res }) };
      }
      if (res.ok !== true) {

        if (/HTTP 404|Not Found/u.test(res.stderr ?? "")) return { kind: "absent" };
        return { kind: "unprovable",
          evidence: forgeCommandEvidence("gh branch read failed", { operation, result: res }) };
      }
      let body;
      try {
        body = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "unprovable", evidence: forgeCommandEvidence("gh branch response could not be parsed",
          { operation, result: res, cause: error }) };
      }
      const sha = body?.object?.sha;
      if (typeof sha !== "string" || !OBJECT_ID_RE.test(sha)) {
        return { kind: "unprovable", evidence: forgeCommandEvidence(
          "gh branch response carries no object id", { operation, result: res }) };
      }
      return { kind: "present", sha };
    },
    publishBranch({ branch, commit, expected }) {
      const ref = `refs/heads/${branch}`;
      if (expected !== null && !OBJECT_ID_RE.test(expected ?? "")) return { kind: "lease_failed" };

      const res = runGit({
        repo: mainRepo,
        args: [
          "-c", "core.hooksPath=/dev/null",
          "-c", "credential.helper=",
          "-c", `credential.https://${host}.helper=!gh auth git-credential`,
          "push", "--no-verify",
          `--force-with-lease=${ref}:${expected ?? ""}`,
          httpsUrl,
          `${commit}:${ref}`
        ],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      if (res && res.ok === true) return { kind: "published" };

      const evidence = captureDiagnosticEvidence(res);
      const stderr = typeof res?.stderr === "string" ? res.stderr : "";
      if (/stale info|fetch first|rejected/iu.test(stderr)) return { kind: "lease_failed", evidence };
      return { kind: "uncertain", evidence };
    },

    listPullRequestPage({ base, head, page, per_page: perPage }) {
      const operation = "list_pull_request_page";
      const headSelector = `${owner}:${head}`;
      const res = runGh({
        args: [
          "api", ...hostArgs,
          `repos/${owner}/${name}/pulls?state=all&base=${base}&head=${headSelector}&per_page=${perPage}&page=${page}`
        ]
      });
      if (res.spawn_error || res.ok !== true) {
        throw forgeCommandError("gh pull request list failed", { operation, result: res });
      }
      let items;
      try {
        items = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "unusable", evidence: forgeCommandEvidence(
          "gh pull request list response could not be parsed", { operation, result: res, cause: error }) };
      }
      if (!Array.isArray(items)) {
        return { kind: "unusable", evidence: forgeCommandEvidence(
          "gh pull request list response is not a list", { operation, result: res }) };
      }
      const mapped = items.map((item) => ({
        number: item?.number,
        state: typeof item?.state === "string" ? item.state : null,
        merged: item?.merged === true || typeof item?.merged_at === "string",
        url: typeof item?.html_url === "string" ? item.html_url : null,
        mergeable_state: typeof item?.mergeable_state === "string" ? item.mergeable_state : null,
        base_ref: item?.base?.ref ?? null,
        head_ref: item?.head?.ref ?? null,
        head_sha: item?.head?.sha ?? null,
        repository: { host, owner, name }
      }));

      return { kind: "ok", items: mapped, has_next: mapped.length >= perPage };
    },

    createPullRequest({ base, head, title, body }) {
      const operation = "create_pull_request";
      const res = runGh({
        args: [
          "api", ...hostArgs, "--method", "POST", `repos/${owner}/${name}/pulls`,
          "-f", `title=${title}`, "-f", `head=${head}`, "-f", `base=${base}`, "-f", `body=${body}`
        ]
      });
      if (res.spawn_error || res.ok !== true) {
        return { kind: "uncertain",
          evidence: forgeCommandEvidence("gh pull request create failed", { operation, result: res }) };
      }
      let item;
      try {
        item = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "uncertain", evidence: forgeCommandEvidence(
          "gh pull request create response could not be parsed", { operation, result: res, cause: error }) };
      }
      return {
        kind: "created",
        pull_request: {
          number: item?.number,
          state: typeof item?.state === "string" ? item.state : null,
          merged: item?.merged === true,
          url: typeof item?.html_url === "string" ? item.html_url : null,
          mergeable_state: typeof item?.mergeable_state === "string" ? item.mergeable_state : null,
          base_ref: item?.base?.ref ?? null,
          head_ref: item?.head?.ref ?? null,
          head_sha: item?.head?.sha ?? null,
          repository: { host, owner, name }
        }
      };
    },

    async observeLandedPullRequest({ number }) {
      const operation = "observe_landed_pull_request";
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error("pull request number unavailable");
      }
      const response = await runGh({
        args: ["api", ...hostArgs, "--include", `repos/${owner}/${name}/pulls/${number}`]
      });
      const { body, etag } = parseIncludedJson(response, operation);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw forgeCommandError("landed pull request observation malformed", { operation, result: response });
      }
      const directRepository = body.repository && typeof body.repository === "object"
        ? { ...body.repository, host }
        : undefined;
      const baseRepository = body.base?.repo && typeof body.base.repo === "object"
        ? { ...body.base.repo, host }
        : undefined;
      return {
        ...body,
        ...(directRepository === undefined ? {} : { repository: directRepository }),
        base: { ...body.base, ...(baseRepository === undefined ? {} : { repo: baseRepository }) },
        forge_identity: body.node_id ?? body.id,
        observation_binding: etag
      };
    },
    async observeExactHeadLanding({ head, merge_commit_sha, observation_binding }) {
      const operation = "observe_exact_head_landing";
      if (!OBJECT_ID_RE.test(head ?? "") || !OBJECT_ID_RE.test(merge_commit_sha ?? "") ||
          typeof observation_binding !== "string" || observation_binding.length === 0) {
        return { ok: false, reason: "exact_head_landing_request_invalid" };
      }
      const result = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/compare/${head}...${merge_commit_sha}`] });
      if (!result?.ok) {
        return { ok: false, observation_binding, reason: "exact_head_comparison_failed",
          evidence: forgeCommandEvidence("gh exact-head comparison failed", { operation, result }) };
      }
      let body;
      try {
        body = JSON.parse(result.stdout);
      } catch (error) {
        return { ok: false, observation_binding, reason: "exact_head_comparison_unparseable",
          evidence: forgeCommandEvidence("gh exact-head comparison response could not be parsed",
            { operation, result, cause: error }) };
      }
      return {
        ok: true,
        ancestor: head,
        descendant: merge_commit_sha,
        relation: body.status === "ahead" || body.status === "identical" ? "ancestor" : "unrelated",
        observation_binding
      };
    }
  };
}

function parseIncludedJson(response, operation) {
  if (!response?.ok) throw forgeCommandError("gh observation command failed", { operation, result: response });
  const raw = String(response.stdout ?? "");
  const blocks = raw.split(/\r?\n\r?\n/gu);
  if (blocks.length < 2) {
    throw forgeCommandError("forge response headers unavailable", { operation, result: response });
  }
  const body = blocks.pop();
  const headerText = blocks.pop();
  const etag = headerText.match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  if (typeof etag !== "string" || etag.length === 0) {
    throw forgeCommandError("forge observation binding unavailable", { operation, result: response });
  }
  try {
    return { body: JSON.parse(body), etag };
  } catch (error) {
    throw forgeCommandError("forge response body could not be parsed",
      { operation, result: response, cause: error });
  }
}

const PULL_REQUEST_PROPERTIES = Object.freeze([
  "number", "repository", "base_ref", "head_ref", "state", "merged", "mergeable_state", "head_sha", "url"
]);

function validateObservedPullRequest({ item, repository, base, head }) {
  const unreadable = (property, error) => ({ ok: false, unreadable: { property, error } });
  const mismatch = { ok: false, mismatch: true };
  try {
    if (!isPlainObject(item)) return mismatch;
  } catch (error) {
    return unreadable(null, error);
  }
  const snapshot = {};
  for (const property of PULL_REQUEST_PROPERTIES) {
    try {
      snapshot[property] = item[property];
    } catch (error) {
      return unreadable(property, error);
    }
  }
  const { number, base_ref: baseRef, head_ref: headRef, state, merged, head_sha: headSha, url } = snapshot;
  let itemRepository = snapshot.repository;
  if (itemRepository !== null && typeof itemRepository === "object") {
    const coordinate = {};
    for (const field of ["host", "owner", "name"]) {
      try {
        coordinate[field] = itemRepository[field];
      } catch (error) {
        return unreadable(`repository.${field}`, error);
      }
    }
    itemRepository = coordinate;
  }

  if (!Number.isSafeInteger(number) || number <= 0) return mismatch;
  if (!sameForgeRepository(itemRepository, repository)) return mismatch;
  if (baseRef !== base || headRef !== head) return mismatch;
  if (!PULL_REQUEST_STATES.has(state) || typeof merged !== "boolean") return mismatch;
  if (merged === true && state !== "closed") return mismatch;
  const mergeableState = snapshot.mergeable_state === undefined ? null : snapshot.mergeable_state;
  if (mergeableState !== null && !PULL_REQUEST_MERGEABLE_STATES.has(mergeableState)) return mismatch;
  if (typeof headSha !== "string" || !OBJECT_ID_RE.test(headSha) || /^0+$/u.test(headSha)) {
    return mismatch;
  }
  if (typeof url !== "string" || url.length === 0 ||
      Buffer.byteLength(url, "utf8") > PULL_REQUEST_URL_MAX_LENGTH || url.includes("%") ||
      /[^\x21-\x7e]/u.test(url)) return mismatch;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {

    return mismatch;
  }
  const canonicalUrl = parsedUrl.href;
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.length === 0 ||
      parsedUrl.username !== "" || parsedUrl.password !== "" || parsedUrl.search !== "" ||
      parsedUrl.hash !== "" || canonicalUrl !== url || canonicalUrl.includes("%") ||
      /[^\x21-\x7e]/u.test(canonicalUrl) ||
      PULL_REQUEST_URL_SECRET_SHAPE_RE.test(url) ||
      PULL_REQUEST_URL_SECRET_SHAPE_RE.test(canonicalUrl)) return mismatch;
  return {
    ok: true,
    pullRequest: Object.freeze({
      number,
      state,
      merged,
      url,
      mergeable_state: mergeableState,
      head_sha: headSha
    })
  };
}

function returnedOutcomeEvidence(returned) {
  return returned?.evidence?.schema_version === DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
    ? returned.evidence
    : captureDiagnosticEvidence(returned);
}

async function observeExactPullRequests({ forge, repository, base, head }) {
  const matches = [];
  for (let page = 1; page <= PULL_REQUEST_PAGE_LIMIT; page += 1) {
    let response;
    try {
      response = await forge.listPullRequestPage({ base, head, page, per_page: PULL_REQUEST_PAGE_SIZE });
    } catch (error) {
      return { ok: false, reason: "pull_request_transport_failed", page,
        evidence: captureDiagnosticEvidence(error) };
    }
    let step = "response";
    try {
      if (!isPlainObject(response) || response.kind !== "ok" || !Array.isArray(response.items)) {
        return { ok: false, reason: "pull_request_observation_unusable", page,
          evidence: returnedOutcomeEvidence(response) };
      }
      step = "items";
      let index = -1;
      for (const item of response.items) {
        index += 1;
        const validated = validateObservedPullRequest({ item, repository, base, head });
        if (validated.unreadable !== undefined) {
          return { ok: false, reason: "observed_pull_request_unreadable", page, item: index,
            property: validated.unreadable.property,
            evidence: captureDiagnosticEvidence(validated.unreadable.error) };
        }
        if (validated.ok !== true) {
          return { ok: false, reason: "observed_pull_request_identity_mismatch", page, item: index };
        }
        matches.push(validated.pullRequest);
      }
      step = "has_next";
      if (response.has_next !== true) return { ok: true, matches };
    } catch (error) {
      return { ok: false, reason: "pull_request_observation_unusable", page, step,
        evidence: captureDiagnosticEvidence(error) };
    }
  }
  return { ok: false, reason: "pull_request_page_limit_exceeded" };
}

function pullRequestObservationRefusal(observation, extra = {}) {
  const { ok: _ok, ...facts } = observation;
  const category = observation.reason === "observed_pull_request_identity_mismatch"
    ? WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT
    : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE;
  return refuse(category, { stage: "pull_request", ...facts, ...extra });
}

async function authenticateCandidateMaterial({ binding, materialization, runGit }) {
  assertTerminalCandidateMaterialization(materialization, binding);
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  await verifyTerminalCandidateCheckout({
    binding, candidateRoot: materialization.candidate_root, runGit
  });
  const observedDecision = await inspectTerminalWkCandidateVersion({ binding, runGit });
  assertTerminalWkCandidateVersionDecision(observedDecision, {
    binding,
    requireSelected: true
  });
  return observedDecision;
}

const CANDIDATE_DISAGREEMENT_CODES = new Map([
  [TerminalWkCandidateError, new Set([
    TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
    TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
    TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    TERMINAL_WK_CANDIDATE_CODES.CONTROLLED_GENERATION_STALE
  ])],
  [TerminalReviewMaterializationError, new Set([
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH
  ])]
]);

function isObservedCheckoutDisagreement(error) {
  return error instanceof TerminalReviewMaterializationError &&
    error.code === TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED &&
    isPlainObject(error.detail) && Object.hasOwn(error.detail, "expected") &&
    Object.hasOwn(error.detail, "actual");
}

function isObservedCandidateDisagreement(error) {
  for (const [owner, codes] of CANDIDATE_DISAGREEMENT_CODES) {
    if (error instanceof owner) return codes.has(error.code) || isObservedCheckoutDisagreement(error);
  }
  return false;
}

function candidateAuthenticationRefusal({ error, phase, binding, observed = null }) {
  const subject = { assigned_unit: binding.canonical_wk_id, candidate: binding.candidate };
  const evidence = captureDiagnosticEvidence(error);
  if (observed !== null || isObservedCandidateDisagreement(error)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "candidate_authentication", phase, reason: "terminal_candidate_binding_moved", subject,
      observed: observed ?? { code: error.code, facts: error.detail ?? null },
      evidence
    });
  }
  return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
    stage: "candidate_authentication", phase,
    reason: "terminal_candidate_authentication_incomplete", subject,
    evidence
  });
}

async function resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const binding = candidateState?.binding;
  const materialization = candidateState?.materialization ?? null;
  if (binding?.canonical_wk_id !== wk) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "exact_terminal_candidate_unavailable"
    });
  }
  if (materialization === null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "terminal_candidate_materialization_unavailable"
    });
  }
  let candidateVersionDecision;
  try {
    candidateVersionDecision = await authenticateCandidateMaterial({ binding, materialization, runGit });
  } catch (error) {
    return candidateAuthenticationRefusal({ error, phase: "identity_resolution", binding });
  }
  const candidateRecord = readCandidateBoundRecord({ mainRepo, wk, binding, deps });
  if (candidateRecord.ok !== true || candidateRecord.record?.initiative == null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: candidateRecord.reason ?? "candidate_bound_record_unavailable"
    });
  }
  const initiative = candidateRecord.record.initiative;
  if (!INITIATIVE_RE.test(initiative)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "candidate_bound_initiative_invalid"
    });
  }

  const resolvedDestination = resolveHandoffDestination({ repo: mainRepo, runGit });
  if (resolvedDestination.ok !== true) {
    const { ok: _ok, ...detail } = resolvedDestination;
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { stage: "destination", ...detail });
  }
  const destination = resolvedDestination.destination;

  const recorded = listRecordedHandoffs({
    repo: mainRepo, initiative, wk, candidate: binding.candidate, runGit
  });
  if (recorded.ok !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
      stage: "handoff_ref", reason: "handoff_ref_unobservable", evidence: recorded.evidence
    });
  }
  const selectedRef = destination.transport === HANDOFF_TRANSPORTS.HOSTED
    ? null
    : wkHandoffRef({ initiative, wk, candidate: binding.candidate, destination });
  const elsewhere = recorded.handoffs.find((handoff) => handoff.ref !== selectedRef);
  if (elsewhere !== undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "destination",
      reason: "handoff_destination_changed",
      recorded_destination: elsewhere.destination,
      selected_destination: projectHandoffDestination(destination)
    });
  }
  let repository = null;
  let forge = null;

  let remoteUrl = null;
  if (destination.transport === HANDOFF_TRANSPORTS.HOSTED) {
    const remote = resolveCanonicalForgeRepository({ repo: mainRepo, remoteName: destination.remote, deps });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        reason: remote.reason,
        ...(remote.evidence === undefined ? {} : { evidence: remote.evidence })
      });
    }
    repository = remote.repository;
    forge = deps.forge ?? buildGhForge({ repository, mainRepo, deps });
    if (!sameForgeRepository(forge.repository, repository)) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { reason: "git_rest_repository_disagreement" });
    }
    const probe = forge.probe();
    if (probe.state !== "authenticated") {
      return { ok: true, unauthenticatedForge: probe, initiative };
    }
  } else if (destination.transport === HANDOFF_TRANSPORTS.GIT) {
    const remote = resolveRemoteUrl({ repo: mainRepo, remoteName: destination.remote, runGit });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        stage: "destination",
        reason: remote.reason,
        remote: destination.remote,
        ...(remote.evidence === undefined ? {} : { evidence: remote.evidence })
      });
    }
    remoteUrl = remote.url;
  }

  const resolveCapturedBase = deps.resolveCapturedWkBase ?? resolveCapturedWkBase;
  const capturedBase = resolveCapturedBase({
    mainRepo,
    unitAddress: `${initiative}/${wk}`
  });
  const landing = candidateRecord.record.base_branch ?? capturedBase?.base_ref ?? null;
  if (!isCanonicalWorkRecordBaseBranch(landing) || capturedBase === null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
      reason: "wk_base_branch_identity_unavailable"
    });
  }
  if (landing !== capturedBase.base_ref) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      reason: "authored_base_branch_disagrees_with_captured_allocation",
      authored_base_branch: landing,
      captured_base_branch: capturedBase.base_ref
    });
  }
  const branch = deriveForgeBranchName({ initiative, wk, candidate: binding.candidate });
  const handoffRef = selectedRef;

  const guard = async () => {
    let observedDecision;
    try {
      observedDecision = await authenticateCandidateMaterial({ binding, materialization, runGit });
    } catch (error) {
      return candidateAuthenticationRefusal({ error, phase: "boundary_reauthentication", binding });
    }
    const moved = ["version_identity", "immutable_version_ref", "current_selection_observation"]
      .find((field) => observedDecision[field] !== candidateVersionDecision[field]);
    if (moved !== undefined) {
      return candidateAuthenticationRefusal({
        error: new Error("terminal candidate version selection moved during forge handoff"),
        phase: "boundary_reauthentication",
        binding,
        observed: {
          field: moved, expected: candidateVersionDecision[moved], actual: observedDecision[moved]
        }
      });
    }
    return null;
  };
  return {
    ok: true,
    identity: Object.freeze({
      binding, candidateVersionDecision, candidateRecord: candidateRecord.record, initiative,
      destination, repository, forge, remoteUrl, landing, branch, handoffRef, guard
    })
  };
}

async function authenticatedBranchHead({ mainRepo, wk, binding, sha, deps }) {
  return (await authenticatedChainAt({ mainRepo, wk, binding, sha, deps }))?.head ?? null;
}

function authenticateExactProposal(matches, authenticatedHead) {
  if (matches.length > 1) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request", reason: "multiple_exact_pull_requests", matched: matches.length
    });
  }
  const pullRequest = matches[0];
  if (pullRequest.head_sha !== authenticatedHead) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request",
      reason: "pull_request_head_sha_disagrees",
      expected: authenticatedHead,
      observed: pullRequest.head_sha
    });
  }
  if (pullRequest.merged !== true && pullRequest.state !== "open") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request",
      reason: "closed_unmerged_or_unknown_pull_request_state",
      state: pullRequest.state
    });
  }
  return { ok: true, pullRequest };
}

function mintAuthenticatedHandoffResult({ identity, authenticatedHead, pullRequest,
  boundaryAuthorization, authentication, effects, diagnostic = null }) {
  const { binding, candidateVersionDecision, initiative, repository, landing, branch } = identity;
  const result = buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF, {
    assigned_unit: binding.canonical_wk_id,
    initiative,
    transport: identity.destination.transport,
    destination: projectHandoffDestination(identity.destination),
    branch,
    commit: authenticatedHead,
    terminal_candidate: binding.candidate,
    tree: binding.candidate_tree,
    parent: binding.base,
    base_branch: landing,
    repository: { host: repository.host, owner: repository.owner, name: repository.name },
    boundary_authorization: boundaryAuthorization,
    version_identity: candidateVersionDecision.version_identity,
    immutable_version_ref: candidateVersionDecision.immutable_version_ref,
    current_selection_observation:
      candidateVersionDecision.current_selection_observation,
    pull_request_state: pullRequest.merged === true ? "already_merged" : "open_exact",
    pull_request: pullRequest,
    proposal_authority: "configured_forge_and_human_merge_actor",
    effects: Object.freeze({ ...effects }),
    ...(authentication === null ? {} : { authentication }),
    ...(diagnostic === null ? {} : { diagnostic })
  });
  authenticatedHandoffResults.set(result, Object.freeze({
    binding,
    version_decision: candidateVersionDecision
  }));
  return result;
}

function forgeProbeDiagnostic(probe) {
  return {
    stage: "forge_probe",
    state: probe?.state ?? null,
    reason: probe?.reason ?? null,
    ...(probe?.evidence === undefined ? {} : { evidence: probe.evidence })
  };
}

function branchObservationFacts(observation) {
  return {
    kind: observation?.kind ?? null,
    ...(observation?.sha === undefined ? {} : { sha: observation.sha }),
    ...(observation?.evidence === undefined ? {} : { evidence: observation.evidence })
  };
}

function branchPublicationFacts(pushed) {
  const kind = pushed?.kind ?? null;
  return kind === "published"
    ? { publish_outcome: kind }
    : { publish_outcome: kind, publish_evidence: returnedOutcomeEvidence(pushed) };
}

function mintAuthenticatedGitHandoffResult({ identity, authenticatedHead,
  boundaryAuthorization, authentication, effects, livePublication = null }) {
  const { binding, candidateVersionDecision, initiative, destination, landing, branch, handoffRef } = identity;
  const git = destination.transport === HANDOFF_TRANSPORTS.GIT;
  const result = buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF, {
    assigned_unit: binding.canonical_wk_id,
    initiative,
    transport: destination.transport,
    destination: projectHandoffDestination(destination),
    branch: git ? branch : null,
    handoff_ref: handoffRef,
    commit: authenticatedHead,
    terminal_candidate: binding.candidate,
    tree: binding.candidate_tree,
    parent: binding.base,
    base_branch: landing,
    boundary_authorization: boundaryAuthorization,
    version_identity: candidateVersionDecision.version_identity,
    immutable_version_ref: candidateVersionDecision.immutable_version_ref,
    current_selection_observation:
      candidateVersionDecision.current_selection_observation,
    landing_authority: "human_git_actor",
    next_action: Object.freeze({
      actor: "human",
      action: "land_exact_handoff_head",
      head: authenticatedHead,
      base_branch: landing,
      ...(git
        ? { remote: destination.remote, branch }
        : { ref: handoffRef }),
      observe_with: Object.freeze({
        tool: "workspace_wk_landing_status",
        arguments: Object.freeze({ assigned_unit: binding.canonical_wk_id })
      })
    }),
    effects: Object.freeze({ ...effects }),
    ...(livePublication?.value === undefined ? {} : { live_record_published: livePublication.value }),
    ...(livePublication?.unobserved === undefined ? {}
      : { live_record_published_unobserved: Object.freeze({ ...livePublication.unobserved }) }),
    ...(authentication === null ? {} : { authentication })
  });
  authenticatedHandoffResults.set(result, Object.freeze({
    binding,
    version_decision: candidateVersionDecision
  }));
  return result;
}

function gitTransportFailure(stage, reason, observation) {
  return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
    stage, reason, ...(observation?.evidence === undefined ? {} : { evidence: observation.evidence })
  });
}

function closeoutPreparationRefusal(prepared) {
  if (prepared.evidence !== undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      stage: prepared.stage,
      reason: prepared.reason,
      observation: prepared.observation,
      evidence: prepared.evidence
    });
  }
  const { ok: _ok, stage: _stage, ...cause } = prepared;
  return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, { stage: "closeout", ...cause });
}

async function authenticatedChainAt({ mainRepo, wk, binding, sha, deps }) {
  const chain = await authenticateWkCloseoutChain({
    mainRepo, wk, candidate: binding.candidate, binding, head: sha, deps
  });
  return chain === null || chain.completion !== sha ? null : chain;
}

function succeedsPublishedChain({ mainRepo, wk, identity, prior, next }) {
  const { projection } = authenticateCloseoutRecord({
    mainRepo, wk, binding: identity.binding, candidateRecord: identity.candidateRecord,
    closeoutRecord: next.closeoutRecord, publishedRecord: prior.closeoutRecord
  });
  return projection.ok === true;
}

function livePublishedUnchanged(live, chain) {
  const digest = computeWorkRecordSourceDigest(live.record);
  return [chain.closeoutRecord, chain.doneRecord].some((record) =>
    record !== null && computeWorkRecordSourceDigest(record) === digest);
}

function observeLandedRetry({ mainRepo, wk, landed }) {
  const live = readLiveWkRecord(mainRepo, wk);
  if (live.ok !== true) return { refusal: closeoutPreparationRefusal(live) };
  if (livePublishedUnchanged(live, landed)) return { unchanged: true };
  return {
    refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "landing", reason: "published_handoff_already_landed", landed_head: landed.head
    })
  };
}

async function decideHandoffRefresh({ mainRepo, wk, identity, published, deps }) {
  const { binding, candidateRecord } = identity;
  const classified = classifyLiveAgainstPublication({ mainRepo, wk, binding, candidateRecord, published });
  if (classified.kind === "unchanged") {
    return { kind: "unchanged", head: published.head, live: classified.live };
  }
  if (classified.kind === "refused") return { refusal: closeoutPreparationRefusal(classified.cause) };
  const { live } = classified;
  const built = await commitWkCloseoutChain({
    mainRepo, wk, candidate: binding.candidate, binding, live, deps
  });
  if (built.ok !== true) return { refusal: closeoutPreparationRefusal(built) };
  return { kind: "refresh", head: built.head, live };
}

function classifyLiveAgainstPublication({ mainRepo, wk, binding, candidateRecord, published }) {
  const observed = readLiveWkRecord(mainRepo, wk);
  if (observed.ok === true && livePublishedUnchanged(observed, published)) {
    return { kind: "unchanged", live: observed };
  }
  const live = readAuthenticatedLiveCloseout({
    mainRepo, wk, candidateRecord, binding, publishedRecord: published.closeoutRecord
  });
  return live.ok === true ? { kind: "refreshable", live } : { kind: "refused", cause: live };
}

export async function assessWkHandoffRefresh({ mainRepo, handoff, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const notRefreshable = (reason, facts = {}) => Object.freeze({ applicable: false, reason, ...facts });
  let retained;
  try {
    retained = assertAuthenticatedWkForgeHandoffResult(handoff);
  } catch {
    return notRefreshable("handoff_not_authenticated");
  }
  const wk = handoff.assigned_unit;
  const { binding } = retained;
  if (handoff.transport === HANDOFF_TRANSPORTS.HOSTED) {
    return notRefreshable("refresh_assessment_requires_local_or_git_handoff", { transport: handoff.transport });
  }
  try {
    const published = await authenticatedChainAt({ mainRepo, wk, binding, sha: handoff.commit, deps: { runGit } });
    if (published === null) return notRefreshable("published_chain_unauthenticated", { published_head: handoff.commit });
    let remoteUrl = null;
    if (handoff.transport === HANDOFF_TRANSPORTS.GIT) {
      const remote = resolveRemoteUrl({ repo: mainRepo, remoteName: handoff.destination.remote, runGit });
      if (remote.ok !== true) return notRefreshable("landing_unobservable", { cause: remote.reason });
      remoteUrl = remote.url;
    }
    const landing = observeGitTransportLanding({
      mainRepo, identity: { destination: handoff.destination, remoteUrl, landing: handoff.base_branch },
      chains: [published], runGit
    });
    if (landing.refusal !== undefined) {
      return notRefreshable("landing_unobservable", { cause: landing.refusal.detail });
    }
    if (landing.landed !== null) {
      return notRefreshable("published_handoff_already_landed", { landed_head: landing.landed.head });
    }
    const candidateRecord = readCandidateBoundRecord({ mainRepo, wk, binding, deps: { runGit } });
    if (candidateRecord.ok !== true) return notRefreshable(candidateRecord.reason);
    const classified = classifyLiveAgainstPublication({
      mainRepo, wk, binding, candidateRecord: candidateRecord.record, published
    });
    if (classified.kind === "unchanged") {
      return notRefreshable("live_record_matches_publication", { published_head: published.head });
    }
    if (classified.kind === "refused") {
      const { ok: _ok, reason, ...cause } = classified.cause;
      return notRefreshable(reason, cause);
    }
    return Object.freeze({
      applicable: true,
      published_head: published.head,

      observed_facts: Object.freeze({ [LIVE_RECORD_PUBLISHED_FACT]: false }),
      next_calls: Object.freeze([Object.freeze(buildNextCall({
        tool: WK_FORGE_HANDOFF_TOOL,
        arguments: { assigned_unit: wk },
        recommended: true,
        success_predicate: { fact: LIVE_RECORD_PUBLISHED_FACT, operator: "is_true" }
      }))])
    });
  } catch (error) {
    if (error instanceof WkCloseoutObservationError) {
      const { reason, ...detail } = wkCloseoutObservationDetail(error);
      return notRefreshable(reason, detail);
    }
    return notRefreshable("refresh_assessment_failed", { evidence: captureDiagnosticEvidence(error) });
  }
}

async function underCapturedLiveRecord({ mainRepo, wk, live, effect }) {
  const locked = await withWorkRecordWriteLock(mainRepo, async () => {
    const current = readLiveWkRecord(mainRepo, wk);
    if (current.ok !== true || current.bytes !== live.bytes) return { changed: true };
    return { changed: false, value: await effect() };
  }, { settle: true });
  if (locked.acquisition_error !== undefined) {
    return {
      refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "work_record_write_lock",
        reason: typeof locked.acquisition_error?.code === "string"
          ? locked.acquisition_error.code : "work_record_write_lock_unavailable",
        evidence: captureDiagnosticEvidence(locked.acquisition_error)
      })
    };
  }
  if (locked.callback_error !== null) throw locked.callback_error;
  if (locked.value.changed) {
    return {
      refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        stage: "closeout", reason: "local_WK_changed_before_publication"
      })
    };
  }
  return {
    value: locked.value.value,
    releaseFailure: locked.release_error === null ? null : captureDiagnosticEvidence(locked.release_error)
  };
}

function withEffects(refusal, effects, facts = {}) {
  return { ...refusal, detail: { ...refusal.detail, ...facts, effects: Object.freeze({ ...effects }) } };
}

function observeGitTransportLanding({ mainRepo, identity, chains, runGit }) {
  const base = observeLandingBaseTip({
    repo: mainRepo, transport: identity.destination.transport, remote: identity.remoteUrl,
    baseBranch: identity.landing, runGit
  });
  if (base.kind === "unobservable") {
    return { refusal: gitTransportFailure("landing_base", "landing_base_unobservable", base) };
  }
  if (base.kind === "absent") return { landed: null };
  for (const chain of chains) {
    try {
      if (isAncestor({ repo: mainRepo, ancestor: chain.head, descendant: base.sha, runGit })) {
        return { landed: chain };
      }
    } catch (error) {
      return {
        refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
          stage: "landing_base", reason: "exact_head_ancestry_unobservable",
          evidence: captureDiagnosticEvidence(error)
        })
      };
    }
  }
  return { landed: null };
}

async function publishGitTransportHandoff({ mainRepo, wk, identity, boundaryAuthorization, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { binding, destination, remoteUrl, branch, handoffRef, guard } = identity;
  const deliversToRemote = destination.transport === HANDOFF_TRANSPORTS.GIT;
  const remoteRef = `refs/heads/${branch}`;
  const effects = {
    closeout_chain: "existing",
    handoff_ref: "existing",
    destination_branch: deliversToRemote ? "existing" : "not_applicable"
  };
  const chainAt = (sha) => authenticatedChainAt({ mainRepo, wk, binding, sha, deps });
  const handedOff = async (head) => ({
    ok: true,
    result: mintAuthenticatedGitHandoffResult({
      identity, authenticatedHead: head, boundaryAuthorization, authentication: null, effects,
      livePublication: await observeLiveRecordPublished(head)
    })
  });

  const observeLiveRecordPublished = async (head) => {
    try {
      const chain = await chainAt(head);
      if (chain === null) return { unobserved: { reason: "returned_head_not_authenticated_chain", head } };
      const live = readLiveWkRecord(mainRepo, wk);
      if (live.ok !== true) return { unobserved: { reason: live.reason } };
      return { value: livePublishedUnchanged(live, chain) };
    } catch (error) {
      return {
        unobserved: error instanceof WkCloseoutObservationError
          ? wkCloseoutObservationDetail(error)
          : { reason: "live_record_publication_unobservable", evidence: captureDiagnosticEvidence(error) }
      };
    }
  };

  let moved = await guard();
  if (moved !== null) return moved;
  const recorded = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit });
  if (recorded.kind === "unobservable") {
    return gitTransportFailure("handoff_ref", "handoff_ref_unobservable", recorded);
  }
  let local = null;
  if (recorded.kind === "present") {
    local = await chainAt(recorded.sha);
    if (local === null) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "handoff_ref", expected: binding.candidate, observed: recorded.sha
      });
    }
  }
  let remote = { kind: "absent" };
  let remoteChain = null;
  if (deliversToRemote) {
    moved = await guard();
    if (moved !== null) return moved;
    remote = observeRemoteRef({ repo: mainRepo, remote: remoteUrl, ref: remoteRef, runGit });
    if (remote.kind === "unobservable") {
      return gitTransportFailure("destination_branch", "destination_branch_unobservable", remote);
    }
    if (remote.kind === "present") {
      remoteChain = await chainAt(remote.sha);

      if (remoteChain === null || (local !== null && remoteChain.head !== local.head &&
          !succeedsPublishedChain({ mainRepo, wk, identity, prior: local, next: remoteChain }))) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "destination_branch", expected: local?.head ?? binding.candidate, observed: remote.sha
        });
      }
    }
  }
  const current = remoteChain ?? local;
  const landedChains = [current, local].filter((chain, index, all) =>
    chain !== null && all.findIndex((other) => other?.head === chain.head) === index);
  const observeLanding = async () => {
    const observed = observeGitTransportLanding({ mainRepo, identity, chains: landedChains, runGit });
    if (observed.refusal !== undefined || observed.landed === null) return observed;
    const retry = observeLandedRetry({ mainRepo, wk, landed: observed.landed });
    if (retry.refusal !== undefined) return { refusal: withEffects(retry.refusal, effects) };
    moved = await guard();
    return moved !== null ? { refusal: moved } : { outcome: await handedOff(observed.landed.head) };
  };

  let target;
  let live;
  if (current === null) {
    live = readAuthenticatedLiveCloseout({
      mainRepo, wk, candidateRecord: identity.candidateRecord, binding
    });
    if (live.ok !== true) return closeoutPreparationRefusal(live);
    const built = await commitWkCloseoutChain({ mainRepo, wk, candidate: binding.candidate, binding, live, deps });
    if (built.ok !== true) return closeoutPreparationRefusal(built);
    effects.closeout_chain = "created";
    target = built.head;
  } else {
    const landing = await observeLanding();
    if (landing.refusal !== undefined) return landing.refusal;
    if (landing.outcome !== undefined) return landing.outcome;
    const decision = await decideHandoffRefresh({ mainRepo, wk, identity, published: current, deps });
    if (decision.refusal !== undefined) return decision.refusal;
    if (decision.kind === "refresh") effects.closeout_chain = "replaced";
    target = decision.head;
    live = decision.live;
  }

  const recheckLanding = async () => {
    if (current === null) return null;
    const landing = await observeLanding();
    if (landing.refusal !== undefined) return landing.refusal;
    return landing.outcome ?? null;
  };

  if (deliversToRemote && (remote.kind !== "present" || remote.sha !== target)) {
    moved = await guard();
    if (moved !== null) return moved;
    const landed = await recheckLanding();
    if (landed !== null) return landed;
    const expected = remote.kind === "present" ? remote.sha : null;
    const pushed = await underCapturedLiveRecord({
      mainRepo, wk, live,
      effect: () => publishRemoteRef({
        repo: mainRepo, remote: remoteUrl, ref: remoteRef, commit: target, expected, runGit
      })
    });
    if (pushed.refusal !== undefined) return withEffects(pushed.refusal, effects);
    moved = await guard();
    if (moved !== null) return moved;

    const observed = observeRemoteRef({ repo: mainRepo, remote: remoteUrl, ref: remoteRef, runGit });

    if (current === null && observed.kind === "present" && observed.sha !== target &&
        await chainAt(observed.sha) !== null) {
      target = observed.sha;
    }
    if (observed.kind !== "present" || observed.sha !== target) {
      const facts = { expected_old: expected, requested: target, observed: observed.sha ?? null };
      if (pushed.value.kind !== "published") {
        return withEffects(gitTransportFailure("destination_branch", "destination_publication_failed",
          pushed.value), effects, facts);
      }
      return withEffects(gitTransportFailure("destination_branch", "candidate_not_observable_after_publication",
        observed), effects, facts);
    }
    if (observed.sha !== expected) effects.destination_branch = expected === null ? "published" : "updated";
  }

  if (recorded.kind !== "present" || recorded.sha !== target) {
    moved = await guard();
    if (moved !== null) return moved;
    const expected = recorded.kind === "present" ? recorded.sha : null;
    const write = () => updateLocalRef({
      repo: mainRepo, ref: handoffRef, commit: target, expected, runGit,
      message: `${wk}: hand off exact terminal candidate ${binding.candidate}`
    });
    let updated;
    if (deliversToRemote) {

      updated = write();
    } else {

      const landed = await recheckLanding();
      if (landed !== null) return landed;
      const locked = await underCapturedLiveRecord({ mainRepo, wk, live, effect: write });
      if (locked.refusal !== undefined) return withEffects(locked.refusal, effects);
      updated = locked.value;
    }
    if (updated.kind === "updated") {
      effects.handoff_ref = expected === null ? "created" : "updated";
    } else {
      const again = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit });
      if (expected === null) {

        const recovered = again.kind === "present" ? await chainAt(again.sha) : null;
        if (recovered === null || (deliversToRemote && recovered.head !== target)) {
          return withEffects(gitTransportFailure("handoff_ref", "handoff_ref_creation_failed", updated),
            effects, { requested: target, observed: again.sha ?? null });
        }
        target = recovered.head;
      } else if (again.kind !== "present" || again.sha !== target) {
        return withEffects(gitTransportFailure("handoff_ref", "handoff_ref_update_failed", updated),
          effects, { expected_old: expected, requested: target, observed: again.sha ?? null });
      }
    }
  }

  const replaced = landedChains.filter((chain) => chain.head !== target);
  if (replaced.length > 0) {
    const landing = observeGitTransportLanding({ mainRepo, identity, chains: replaced, runGit });
    if (landing.refusal !== undefined) return withEffects(landing.refusal, effects, { published_head: target });
    if (landing.landed !== null) {
      return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "landing_base", reason: "handoff_landed_during_refresh",
        landed_head: landing.landed.head, published_head: target
      }), effects);
    }
  }
  moved = await guard();
  if (moved !== null) return moved;
  return await handedOff(target);
}

async function observeExistingGitTransportHandoff({ mainRepo, wk, identity, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { binding, handoffRef, guard } = identity;
  let moved = await guard();
  if (moved !== null) return moved;
  const recorded = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit });
  if (recorded.kind === "unobservable") {
    return gitTransportFailure("handoff_ref", "handoff_ref_unobservable", recorded);
  }
  if (recorded.kind === "absent") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "handoff_ref", reason: "existing_publication_absent"
    });
  }
  const head = await authenticatedBranchHead({ mainRepo, wk, binding, sha: recorded.sha, deps });
  if (head === null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "handoff_ref", expected: binding.candidate, observed: recorded.sha
    });
  }
  moved = await guard();
  if (moved !== null) return moved;
  return {
    ok: true,
    result: mintAuthenticatedGitHandoffResult({
      identity,
      authenticatedHead: head,
      boundaryAuthorization: null,
      authentication: "observed_existing_publication",
      effects: {
        closeout_chain: "existing",
        handoff_ref: "existing",
        destination_branch: identity.destination.transport === HANDOFF_TRANSPORTS.GIT
          ? "not_observed" : "not_applicable"
      }
    })
  };
}

function withAttemptedMutations(refusal, mutations) {
  const detail = refusal.detail !== null && typeof refusal.detail === "object" ? refusal.detail : {};
  const inline = new Set([detail.publish_evidence, detail.create_evidence].filter((value) => value !== undefined));
  const carried = mutations.attempted
    .filter((mutation) => !inline.has(mutation.publish_evidence ?? mutation.create_evidence));
  const uncertain = mutations.pending !== null && detail.uncertain_effect === undefined;
  if (carried.length === 0 && !uncertain) return refusal;
  return { ...refusal, detail: { ...detail,
    ...(uncertain ? { uncertain_effect: mutations.pending } : {}),
    ...(carried.length === 0 ? {} : { attempted_mutations: carried }) } };
}

export async function publishExactTerminalCandidate(input) {
  const mutations = { attempted: [], pending: null };
  const outcome = await publishTerminalCandidateRecordingMutations(input, mutations);
  return outcome?.ok === false ? withAttemptedMutations(outcome, mutations) : outcome;
}

async function publishTerminalCandidateRecordingMutations({ mainRepo, wk, candidateState, deps = {} }, mutations) {

  let effects = null;
  let effectInFlight = null;
  try {
    const resolved = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps });
    if (resolved.ok !== true) return resolved;
    if (resolved.unauthenticatedForge !== undefined) {
      const probe = resolved.unauthenticatedForge;
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk,
        initiative: resolved.initiative,
        reason: probe.state === "error" ? probe.reason : "authenticated_forge_required_for_terminal_candidate",
        diagnostic: forgeProbeDiagnostic(probe)
      }) };
    }
    const identity = resolved.identity;
    const { binding, candidateRecord, repository, forge, landing, branch, guard } = identity;
    const policy = await resolveWkForgeHandoffBoundaryAuthorization({
      policy: deps.forgeHandoffCcePolicy ?? null,
      binding,
      initiative: identity.initiative,
      destination: identity.destination,
      repository,
      landing,
      branch
    });
    if (policy.ok !== true) return policy;
    if (identity.destination.transport !== HANDOFF_TRANSPORTS.HOSTED) {
      return await publishGitTransportHandoff({
        mainRepo, wk, identity, boundaryAuthorization: policy.authorization, deps
      });
    }

    const chainAt = (sha) => authenticatedChainAt({ mainRepo, wk, binding, sha, deps });
    effects = { closeout_chain: "existing", destination_branch: "existing", pull_request: "existing" };

    const recordAnswer = (effect, facts, evidence) => {
      mutations.pending = effect;
      if (evidence !== undefined) mutations.attempted.push({ effect, ...facts });
    };
    const observeProposals = () => observeExactPullRequests({ forge, repository, base: landing, head: branch });
    const handedOff = (authenticatedHead, pullRequest) => ({
      ok: true,
      result: mintAuthenticatedHandoffResult({
        identity, authenticatedHead, pullRequest, boundaryAuthorization: policy.authorization,
        authentication: null, effects,
        diagnostic: mutations.attempted.length === 0 ? null : {
          reason: "unconfirmed_mutation_answer_superseded_by_observation",
          mutations: [...mutations.attempted]
        }
      })
    });

    const observeLandedProposal = async (pullRequest) => {
      const landed = await chainAt(pullRequest.head_sha);
      if (landed === null) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "pull_request", expected: binding.candidate, observed: pullRequest.head_sha
        });
      }
      const retry = observeLandedRetry({ mainRepo, wk, landed });
      if (retry.refusal !== undefined) return withEffects(retry.refusal, effects);
      const moved = await guard();
      return moved ?? handedOff(landed.head, pullRequest);
    };
    const landedProposal = (matches) =>
      matches.length === 1 && matches[0].merged === true ? matches[0] : null;

    const proposalAdmitsHead = (matches, head) =>
      matches.length === 0 ? { ok: true } : authenticateExactProposal(matches, head);

    let moved = await guard();
    if (moved !== null) return moved;
    let branchObservation = await forge.observeRemoteBranch({ branch });
    moved = await guard();
    if (moved !== null) return moved;
    if (branchObservation?.kind !== "present" && branchObservation?.kind !== "absent") {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable",
        observation: branchObservationFacts(branchObservation)
      });
    }
    let published = null;
    if (branchObservation.kind === "present") {
      published = await chainAt(branchObservation.sha);
      if (published === null) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "branch", expected: binding.candidate, observed: branchObservation.sha
        });
      }
    }

    let observedPrs = await observeProposals();
    moved = await guard();
    if (moved !== null) return moved;
    if (observedPrs.ok !== true) return pullRequestObservationRefusal(observedPrs);
    if (landedProposal(observedPrs.matches) !== null) {
      return await observeLandedProposal(landedProposal(observedPrs.matches));
    }

    let authenticatedHead;
    let refreshedFrom = null;
    if (published === null) {

      const live = readAuthenticatedLiveCloseout({
        mainRepo, wk, candidateRecord: identity.candidateRecord, binding
      });
      if (live.ok !== true) return closeoutPreparationRefusal(live);
      const prepared = await commitWkCloseoutChain({
        mainRepo, wk, candidate: binding.candidate, binding, live, deps
      });
      if (prepared.ok !== true) return closeoutPreparationRefusal(prepared);
      effects.closeout_chain = "created";
      authenticatedHead = prepared.head;
      moved = await guard();
      if (moved !== null) return moved;
      effectInFlight = "destination_branch";
      const pushed = await underCapturedLiveRecord({
        mainRepo, wk, live,
        effect: () => forge.publishBranch({ branch, commit: authenticatedHead, expected: null })
      });
      effectInFlight = null;
      if (pushed.refusal !== undefined) return withEffects(pushed.refusal, effects);
      const publication = branchPublicationFacts(pushed.value);
      recordAnswer("destination_branch", publication, publication.publish_evidence);
      moved = await guard();
      if (moved !== null) return moved;
      branchObservation = await forge.observeRemoteBranch({ branch });
      moved = await guard();
      if (moved !== null) return moved;

      if (branchObservation?.kind === "present" && branchObservation.sha !== authenticatedHead &&
          await chainAt(branchObservation.sha) !== null) {
        authenticatedHead = branchObservation.sha;
      }
      if (branchObservation?.kind !== "present" || branchObservation.sha !== authenticatedHead) {

        return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
          stage: "branch", reason: "candidate_not_observable_after_publication",
          ...publication, observation: branchObservationFacts(branchObservation)
        }), effects);
      }
      mutations.pending = null;
      effects.destination_branch = "published";
    } else {
      const admitted = proposalAdmitsHead(observedPrs.matches, published.head);
      if (admitted.ok !== true) return admitted;
      const decision = await decideHandoffRefresh({ mainRepo, wk, identity, published, deps });
      if (decision.refusal !== undefined) return decision.refusal;
      authenticatedHead = decision.head;
      if (decision.kind === "refresh") {
        effects.closeout_chain = "replaced";

        moved = await guard();
        if (moved !== null) return moved;
        const again = await observeProposals();
        if (again.ok !== true) return pullRequestObservationRefusal(again);
        if (landedProposal(again.matches) !== null) {
          return await observeLandedProposal(landedProposal(again.matches));
        }
        const stillAdmitted = proposalAdmitsHead(again.matches, published.head);
        if (stillAdmitted.ok !== true) return stillAdmitted;
        effectInFlight = "destination_branch";
        const pushed = await underCapturedLiveRecord({
          mainRepo, wk, live: decision.live,
          effect: () => forge.publishBranch({ branch, commit: authenticatedHead, expected: published.head })
        });
        effectInFlight = null;
        if (pushed.refusal !== undefined) return withEffects(pushed.refusal, effects);
        const publication = branchPublicationFacts(pushed.value);
        recordAnswer("destination_branch", publication, publication.publish_evidence);
        moved = await guard();
        if (moved !== null) return moved;

        branchObservation = await forge.observeRemoteBranch({ branch });
        moved = await guard();
        if (moved !== null) return moved;
        const observedHead = branchObservation?.kind === "present" ? branchObservation.sha : null;
        if (observedHead !== authenticatedHead) {

          const disagreement = branchObservation?.kind === "absent" ||
            (observedHead !== null && observedHead !== published.head);
          return withEffects(refuse(disagreement
            ? WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT
            : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
            stage: "branch", reason: "handoff_branch_update_not_observed",
            ...publication,
            expected_old: published.head, requested: authenticatedHead, observed: observedHead,
            observation: branchObservationFacts(branchObservation)
          }), effects);
        }
        mutations.pending = null;
        effects.destination_branch = "updated";
        refreshedFrom = published.head;
        observedPrs = await observeProposals();
        moved = await guard();
        if (moved !== null) return moved;
        if (observedPrs.ok !== true) {
          return withEffects(pullRequestObservationRefusal(observedPrs), effects,
            { published_head: authenticatedHead });
        }
        const landedDuring = landedProposal(observedPrs.matches);
        if (landedDuring !== null) {

          return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
            stage: "pull_request", reason: "handoff_landed_during_refresh",
            landed_head: landedDuring.head_sha, published_head: authenticatedHead
          }), effects);
        }
      }
    }

    if (observedPrs.matches.length === 0) {
      moved = await guard();
      if (moved !== null) return moved;

      let createOutcome;
      effectInFlight = "pull_request";
      try {
        const returned = await forge.createPullRequest({
          base: landing,
          head: branch,
          title: `${wk}: ${String(candidateRecord.title ?? "terminal candidate").trim()}`,
          body: `Exact validated terminal candidate ${binding.candidate} for ${wk}; reviewer and redteam evidence is advisory.\n`
        });
        const kind = returned?.kind;
        createOutcome = kind === "created"
          ? { create_outcome: "returned", create_kind: kind }
          : { create_outcome: "returned", create_kind: typeof kind === "string" ? kind : null,
            create_evidence: returnedOutcomeEvidence(returned) };
      } catch (error) {

        createOutcome = { create_outcome: "threw", create_evidence: captureDiagnosticEvidence(error) };
      }
      effectInFlight = null;
      recordAnswer("pull_request", createOutcome, createOutcome.create_evidence);
      moved = await guard();
      if (moved !== null) return moved;
      observedPrs = await observeProposals();
      moved = await guard();
      if (moved !== null) return moved;
      if (observedPrs.ok !== true) {
        return withEffects(pullRequestObservationRefusal(observedPrs, {
          after_create: true,
          ...createOutcome
        }), effects, { uncertain_effect: "pull_request" });
      }
      if (observedPrs.matches.length > 1) {
        return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "pull_request",
          reason: "multiple_exact_pull_requests_after_create",
          matched: observedPrs.matches.length,
          ...createOutcome
        }), effects);
      }
      if (observedPrs.matches.length !== 1) {
        return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
          stage: "pull_request",
          reason: "pull_request_not_exactly_observable_after_create",
          ...createOutcome
        }), effects, { uncertain_effect: "pull_request" });
      }
      mutations.pending = null;
      effects.pull_request = "created";
    }
    if (branchObservation.sha !== authenticatedHead) {
      return withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "pull_request",
        reason: "pull_request_head_sha_disagrees",
        expected: authenticatedHead,
        observed: branchObservation.sha
      }), effects);
    }
    const proposal = authenticateExactProposal(observedPrs.matches, authenticatedHead);
    if (proposal.ok !== true) {
      return refreshedFrom === null && effects.pull_request === "existing" &&
        effects.destination_branch === "existing"
        ? proposal : withEffects(proposal, effects);
    }

    moved = await guard();
    if (moved !== null) return moved;
    return handedOff(authenticatedHead, proposal.pullRequest);
  } catch (error) {
    if (error instanceof WkCloseoutObservationError) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, wkCloseoutObservationDetail(error));
    }

    const refusal = refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      stage: "publication",
      reason: "terminal_candidate_publication_threw",
      subject: { assigned_unit: wk, candidate: candidateState?.binding?.candidate ?? null },
      evidence: captureDiagnosticEvidence(error)
    });
    return effects === null
      ? { ...refusal, detail: { ...refusal.detail, effects_observed: false } }
      : withEffects(refusal, effects, (effectInFlight ?? mutations.pending) === null ? {}
        : { uncertain_effect: effectInFlight ?? mutations.pending });
  }
}

async function observeExistingPublication({ mainRepo, wk, candidateState, deps }) {
  try {
    const resolved = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps });
    if (resolved.ok !== true) return resolved;
    if (resolved.unauthenticatedForge !== undefined) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "forge", reason: "authenticated_forge_required_for_existing_publication",
        probe: forgeProbeDiagnostic(resolved.unauthenticatedForge)
      });
    }
    const identity = resolved.identity;
    if (identity.destination.transport !== HANDOFF_TRANSPORTS.HOSTED) {
      return await observeExistingGitTransportHandoff({ mainRepo, wk, identity, deps });
    }
    const { binding, repository, forge, landing, branch, guard } = identity;
    let moved = await guard();
    if (moved !== null) return moved;
    const branchObservation = await forge.observeRemoteBranch({ branch });
    const observedPrs = await observeExactPullRequests({ forge, repository, base: landing, head: branch });
    moved = await guard();
    if (moved !== null) return moved;
    if (observedPrs.ok !== true) return pullRequestObservationRefusal(observedPrs);
    if (observedPrs.matches.length === 0) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        stage: "pull_request", reason: "existing_publication_absent"
      });
    }

    let observedHead;
    if (observedPrs.matches.length === 1 && observedPrs.matches[0].merged === true &&
        (branchObservation?.kind === "present" || branchObservation?.kind === "absent")) {
      observedHead = observedPrs.matches[0].head_sha;
    } else if (branchObservation?.kind === "present") {
      observedHead = branchObservation.sha;
    } else if (branchObservation?.kind === "absent") {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        stage: "branch", reason: "existing_publication_absent"
      });
    } else {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable",
        observation: branchObservationFacts(branchObservation)
      });
    }
    const authenticatedHead = await authenticatedBranchHead({
      mainRepo, wk, binding, sha: observedHead, deps
    });
    if (authenticatedHead === null) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "branch", expected: binding.candidate, observed: observedHead
      });
    }
    const proposal = authenticateExactProposal(observedPrs.matches, authenticatedHead);
    if (proposal.ok !== true) return proposal;
    moved = await guard();
    if (moved !== null) return moved;
    return {
      ok: true,
      result: mintAuthenticatedHandoffResult({
        identity,
        authenticatedHead,
        pullRequest: proposal.pullRequest,
        boundaryAuthorization: null,
        authentication: "observed_existing_publication",
        effects: { closeout_chain: "existing", destination_branch: "existing", pull_request: "existing" }
      })
    };
  } catch (error) {
    if (error instanceof WkCloseoutObservationError) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, wkCloseoutObservationDetail(error));
    }
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      stage: "existing_publication_observation",
      reason: "existing_publication_observation_threw",
      subject: { assigned_unit: wk, candidate: candidateState?.binding?.candidate ?? null },
      evidence: captureDiagnosticEvidence(error)
    });
  }
}

async function authenticateForgeGenerationAuthority({ mainRepo, wk, candidateState }) {
  const candidateBinding = candidateState?.binding;
  let authority;
  try {
    authority = await authenticateCurrentControlledContractGenerationAtW({
      repoRoot: mainRepo,
      wkId: wk,
      expectedWkTipSha: candidateBinding?.wk_tip,
      expectedGeneration: candidateBinding?.controlled_generation,
      deps: {}
    });
  } catch (error) {

    if (error instanceof ControlledContractGenerationPersistenceError &&
        error.code === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED &&
        typeof error.details?.expected_tip === "string" &&
        typeof error.details?.actual_tip === "string") {
      return Object.freeze({ ok: false, detail: Object.freeze({
        stage: "generation_authentication",
        reason: "terminal_candidate_binding_moved",
        subject: { assigned_unit: wk, candidate: candidateBinding?.candidate ?? null },
        observed: { code: error.code, expected_tip: error.details.expected_tip,
          actual_tip: error.details.actual_tip },
        evidence: captureDiagnosticEvidence(error)
      }) });
    }
    throw error;
  }
  return Object.freeze({ ok: true, generationBinding: authority.binding,
    authenticated: authority.authenticated });
}

export async function defaultWkForgeHandoff({ mainRepo, assignedUnit, deps = {} } = {}) {
  if (typeof mainRepo !== "string" || mainRepo.length === 0) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "main_repo_missing" });
  }
  if (typeof assignedUnit !== "string" || !WK_RECORD_RE.test(assignedUnit)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "assigned_unit_invalid" });
  }
  const wk = assignedUnit;
  if (typeof deps.resolveTerminalCandidatePublicationState !== "function") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "exact_terminal_candidate_resolver_unavailable"
    });
  }

  let resolutionFailure = null;
  try {
    return await withControlledContractAuthorityExclusion({
      repoRoot: mainRepo,
      wkId: wk,
      run: async (authorityContext) => {
        let candidateState;
        try {
          candidateState = await deps.resolveTerminalCandidatePublicationState(
            wk, authorityContext
          );
        } catch (error) {
          resolutionFailure = { error };
          throw error;
        }
        if (candidateState === null || candidateState === undefined) {
          return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
            reason: "exact_terminal_candidate_unavailable"
          });
        }
        const generationAuthority = await authenticateForgeGenerationAuthority({
          mainRepo, wk, candidateState
        });
        if (generationAuthority.ok !== true) {
          return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, generationAuthority.detail);
        }
        return retainGenerationBinding(
          await publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps }),
          generationAuthority
        );
      }
    });
  } catch (error) {
    if (resolutionFailure !== null && error === resolutionFailure.error) throw error;

    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "controlled_contract_authority",
      reason: "controlled_contract_generation_authority_refused",
      subject: { assigned_unit: wk },
      evidence: captureDiagnosticEvidence(error)
    });
  }
}

export async function observeAuthenticatedWkForgeHandoff({
  mainRepo, assignedUnit, authorityContext, deps = {}
} = {}) {
  if (typeof mainRepo !== "string" || mainRepo.length === 0) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "main_repo_missing" });
  }
  if (typeof assignedUnit !== "string" || !WK_RECORD_RE.test(assignedUnit)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "assigned_unit_invalid" });
  }
  const wk = assignedUnit;
  if (typeof deps.observeTerminalCandidatePublicationState !== "function") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "exact_terminal_candidate_observer_unavailable"
    });
  }
  let authorityValidated = false;
  try {
    return await runWithControlledContractAuthorityContext({
      repoRoot: mainRepo,
      wkId: wk,
      authorityContext,
      run: () => {
        authorityValidated = true;
        return observeUnderValidatedAuthority();
      }
    });
  } catch (error) {

    if (authorityValidated) throw error;
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "authority_context",
      reason: typeof error?.code === "string" ? error.code : "controlled_contract_wk_authority_context_invalid",
      subject: { assigned_unit: wk },
      evidence: captureDiagnosticEvidence(error)
    });
  }

  async function observeUnderValidatedAuthority() {
    const candidateState = await deps.observeTerminalCandidatePublicationState(
      wk, authorityContext
    );
    if (candidateState === null || candidateState === undefined) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        reason: "exact_terminal_candidate_unavailable"
      });
    }
    const generationAuthority = await authenticateForgeGenerationAuthority({
      mainRepo, wk, candidateState
    });
    if (generationAuthority.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, generationAuthority.detail);
    }
    return retainGenerationBinding(
      await observeExistingPublication({ mainRepo, wk, candidateState, deps }),
      generationAuthority
    );
  }
}

function retainGenerationBinding(outcome, generationAuthority) {
  const retained = outcome?.ok === true ? authenticatedHandoffResults.get(outcome.result) : undefined;
  if (retained !== undefined) {
    authenticatedHandoffResults.set(outcome.result, Object.freeze({
      ...retained,
      generation_binding: generationAuthority.generationBinding
    }));
  }
  return outcome;
}

function buildResult(kind, fields) {
  return Object.freeze({
    schema_version: WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
    kind,
    ...fields,
    ...(fields.repository ? { repository: Object.freeze({ ...fields.repository }) } : {})
  });
}
