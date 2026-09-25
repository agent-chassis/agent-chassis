

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { computeWorkRecordSourceDigest } from "../../../wiki-core/src/lib/work-record-schema.mjs";
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
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import {
  authenticateCurrentControlledContractGenerationAtW
} from "./controlled-carrier-attachment-primitive.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import { authenticateWkCloseoutProjection } from "./wk-forge-handoff-recovery.mjs";
import { resolveCapturedWkBase } from "./worktree-substrate-identity.mjs";
import { authenticateCanonicalIntegratedDeliveryTransition } from
  "./backend-integrated-scope-authority.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import {
  createLocalRefIfAbsent,
  git,
  HANDOFF_TRANSPORTS,
  listRecordedHandoffs,
  observeRemoteRef,
  publishRemoteRefIfAbsent,
  readLocalRef,
  resolveHandoffDestination,
  resolveRemoteUrl,
  wkHandoffRef
} from "./wk-handoff-destination.mjs";
import { isCanonicalWorkRecordBaseBranch } from
  "@agent-chassis/wiki-core/src/lib/work-record-base-branch.mjs";

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

function refuse(category, detail) {
  return { ok: false, category, detail: detail ?? null };
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
  let res;
  try {
    res = spawnSync("gh", [...args], {
      encoding: "utf8",
      cwd: cwd ?? undefined,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, spawn_error: err?.message ?? String(err) };
  }
  if (res.error) return { ok: false, spawn_error: res.error.message ?? String(res.error) };
  return {
    ok: res.status === 0,
    status: res.status ?? null,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : ""
  };
}

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

function authenticateCloseoutRecord({ mainRepo, wk, binding, candidateRecord, closeoutRecord }) {
  const delivery = authenticateCloseoutIntegratedDelivery({
    mainRepo, wk, binding, candidateRecord, closeoutRecord
  });
  const projection = authenticateWkCloseoutProjection({
    candidateRecord, liveRecord: closeoutRecord, integratedDelivery: delivery.expectation
  });
  return { projection, deliveryFailure: delivery.failure };
}

export async function prepareWkCloseoutChain({
  mainRepo, wk, candidate, candidateRecord, binding = null, deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const path = `wiki/work-records/${wk}.json`;
  const localPath = nodePath.join(mainRepo, path);
  let localRecord;
  try {
    safeLocalWkPath(mainRepo, localPath);
    localRecord = JSON.parse(readLocalWkAtomically(localPath));
  } catch {
    return { ok: false, reason: "local_WK_unsafe_or_unreadable" };
  }
  if (!isPlainObject(localRecord) || localRecord.id !== wk || localRecord.status !== "review") {
    return { ok: false, reason: "local_WK_not_closeout_ready" };
  }
  const { projection, deliveryFailure } = authenticateCloseoutRecord({
    mainRepo, wk, binding, candidateRecord, closeoutRecord: localRecord
  });
  if (projection.ok !== true) {

    const { ok: _ok, ...projectionCause } = projection;
    return {
      ok: false,
      reason: "local_WK_not_authenticated_against_candidate",
      projection: projectionCause,
      ...(deliveryFailure === null ? {} : { integrated_delivery_authority: deliveryFailure })
    };
  }
  const tempRoot = mkdtempSync(nodePath.join(os.tmpdir(), "wk-forge-closeout-"));
  try {
    const closeout = await commitOnlyWk({
      runGit, repo: mainRepo, parent: candidate, path, tempRoot, message: `${wk}: record closeout`,
      recordBytes: JSON.stringify(projection.closeoutRecord, null, 2) + "\n"
    });
    const completion = await commitOnlyWk({
      runGit, repo: mainRepo, parent: closeout, path, tempRoot, message: `${wk}: complete`,
      recordBytes: JSON.stringify({ ...projection.closeoutRecord, status: "done" }, null, 2) + "\n"
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
      const auth = runGh({ args: ["auth", "status", ...hostArgs] });
      if (auth.spawn_error) return { state: "unauthenticated", reason: "gh_absent" };
      if (auth.ok !== true) return { state: "unauthenticated", reason: "gh_not_authenticated_for_host" };
      const repoRes = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}`] });
      if (repoRes.spawn_error || repoRes.ok !== true) {
        return { state: "error", reason: "exact_repository_access_unproven" };
      }
      let body;
      try {
        body = JSON.parse(repoRes.stdout);
      } catch {
        return { state: "error", reason: "repository_api_response_unparseable" };
      }

      if (typeof body.full_name === "string" && body.full_name !== `${owner}/${name}`) {
        return { state: "error", reason: "repository_identity_mismatch" };
      }
      return { state: "authenticated" };
    },
    observeRemoteBranch({ branch }) {
      const res = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/git/ref/heads/${branch}`] });
      if (res.spawn_error) return { kind: "unprovable" };
      if (res.ok !== true) {

        if (/HTTP 404|Not Found/u.test(res.stderr ?? "")) return { kind: "absent" };
        return { kind: "unprovable" };
      }
      let body;
      try {
        body = JSON.parse(res.stdout);
      } catch {
        return { kind: "unprovable" };
      }
      const sha = body?.object?.sha;
      if (typeof sha !== "string" || !OBJECT_ID_RE.test(sha)) return { kind: "unprovable" };
      return { kind: "present", sha };
    },
    publishBranchIfAbsent({ branch, commit }) {
      const ref = `refs/heads/${branch}`;

      const res = runGit({
        repo: mainRepo,
        args: [
          "-c", "core.hooksPath=/dev/null",
          "-c", "credential.helper=",
          "-c", `credential.https://${host}.helper=!gh auth git-credential`,
          "push", "--no-verify",
          `--force-with-lease=${ref}:`,
          httpsUrl,
          `${commit}:${ref}`
        ],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      if (res && res.ok === true) return { kind: "published" };
      const stderr = typeof res?.stderr === "string" ? res.stderr : "";
      if (/stale info|fetch first|rejected/iu.test(stderr)) return { kind: "lease_failed" };
      return { kind: "uncertain" };
    },

    listPullRequestPage({ base, head, page, per_page: perPage }) {
      const headSelector = `${owner}:${head}`;
      const res = runGh({
        args: [
          "api", ...hostArgs,
          `repos/${owner}/${name}/pulls?state=all&base=${base}&head=${headSelector}&per_page=${perPage}&page=${page}`
        ]
      });
      if (res.spawn_error || res.ok !== true) throw new Error("pull_request_list_transport_failed");
      let items;
      try {
        items = JSON.parse(res.stdout);
      } catch {
        return { kind: "unusable" };
      }
      if (!Array.isArray(items)) return { kind: "unusable" };
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
      const res = runGh({
        args: [
          "api", ...hostArgs, "--method", "POST", `repos/${owner}/${name}/pulls`,
          "-f", `title=${title}`, "-f", `head=${head}`, "-f", `base=${base}`, "-f", `body=${body}`
        ]
      });
      if (res.spawn_error || res.ok !== true) return { kind: "uncertain" };
      let item;
      try {
        item = JSON.parse(res.stdout);
      } catch {
        return { kind: "uncertain" };
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
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error("pull request number unavailable");
      }
      const response = await runGh({
        args: ["api", ...hostArgs, "--include", `repos/${owner}/${name}/pulls/${number}`]
      });
      const { body, etag } = parseIncludedJson(response);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("landed pull request observation malformed");
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
      if (!OBJECT_ID_RE.test(head ?? "") || !OBJECT_ID_RE.test(merge_commit_sha ?? "") ||
          typeof observation_binding !== "string" || observation_binding.length === 0) {
        return { ok: false };
      }
      const result = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/compare/${head}...${merge_commit_sha}`] });
      if (!result?.ok) return { ok: false, observation_binding };
      const body = JSON.parse(result.stdout);
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

function parseIncludedJson(response) {
  const raw = String(response?.stdout ?? "");
  const blocks = raw.split(/\r?\n\r?\n/gu);
  if (!response?.ok || blocks.length < 2) throw new Error("forge response headers unavailable");
  const body = blocks.pop();
  const headerText = blocks.pop();
  const etag = headerText.match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  if (typeof etag !== "string" || etag.length === 0) {
    throw new Error("forge observation binding unavailable");
  }
  return { body: JSON.parse(body), etag };
}

function validateObservedPullRequest({ item, repository, base, head }) {
  try {
    if (!isPlainObject(item)) return null;

    const number = item.number;
    const itemRepository = item.repository;
    const baseRef = item.base_ref;
    const headRef = item.head_ref;
    const state = item.state;
    const merged = item.merged;
    const mergeableStateValue = item.mergeable_state;
    const headSha = item.head_sha;
    const url = item.url;

    if (!Number.isSafeInteger(number) || number <= 0) return null;
    if (!sameForgeRepository(itemRepository, repository)) return null;
    if (baseRef !== base || headRef !== head) return null;
    if (!PULL_REQUEST_STATES.has(state) || typeof merged !== "boolean") return null;
    if (merged === true && state !== "closed") return null;
    const mergeableState = mergeableStateValue === undefined ? null : mergeableStateValue;
    if (mergeableState !== null && !PULL_REQUEST_MERGEABLE_STATES.has(mergeableState)) return null;
    if (typeof headSha !== "string" || !OBJECT_ID_RE.test(headSha) || /^0+$/u.test(headSha)) {
      return null;
    }
    if (typeof url !== "string" || url.length === 0 ||
        Buffer.byteLength(url, "utf8") > PULL_REQUEST_URL_MAX_LENGTH || url.includes("%") ||
        /[^\x21-\x7e]/u.test(url)) return null;
    const parsedUrl = new URL(url);
    const canonicalUrl = parsedUrl.href;
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.length === 0 ||
        parsedUrl.username !== "" || parsedUrl.password !== "" || parsedUrl.search !== "" ||
        parsedUrl.hash !== "" || canonicalUrl !== url || canonicalUrl.includes("%") ||
        /[^\x21-\x7e]/u.test(canonicalUrl) ||
        PULL_REQUEST_URL_SECRET_SHAPE_RE.test(url) ||
        PULL_REQUEST_URL_SECRET_SHAPE_RE.test(canonicalUrl)) return null;
    return Object.freeze({
      number,
      state,
      merged,
      url,
      mergeable_state: mergeableState,
      head_sha: headSha
    });
  } catch {
    return null;
  }
}

async function observeExactPullRequests({ forge, repository, base, head }) {
  const matches = [];
  for (let page = 1; page <= PULL_REQUEST_PAGE_LIMIT; page += 1) {
    let response;
    try {
      response = await forge.listPullRequestPage({ base, head, page, per_page: PULL_REQUEST_PAGE_SIZE });
    } catch {
      return { ok: false, reason: "pull_request_transport_failed" };
    }
    try {
      if (!isPlainObject(response) || response.kind !== "ok" || !Array.isArray(response.items)) {
        return { ok: false, reason: "pull_request_observation_unusable" };
      }
      for (const item of response.items) {
        const validated = validateObservedPullRequest({ item, repository, base, head });
        if (validated === null) {
          return { ok: false, reason: "observed_pull_request_identity_mismatch" };
        }
        matches.push(validated);
      }
      if (response.has_next !== true) return { ok: true, matches };
    } catch {
      return { ok: false, reason: "pull_request_observation_unusable" };
    }
  }
  return { ok: false, reason: "pull_request_page_limit_exceeded" };
}

function pullRequestObservationRefusal(observation, extra = {}) {
  const category = observation.reason === "observed_pull_request_identity_mismatch"
    ? WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT
    : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE;
  return refuse(category, { stage: "pull_request", reason: observation.reason, ...extra });
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
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "terminal_candidate_binding_moved",
      message: error?.message ?? String(error)
    });
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
    try {
      const observedDecision = await authenticateCandidateMaterial({ binding, materialization, runGit });
      if (observedDecision.version_identity !== candidateVersionDecision.version_identity ||
          observedDecision.immutable_version_ref !== candidateVersionDecision.immutable_version_ref ||
          observedDecision.current_selection_observation !==
            candidateVersionDecision.current_selection_observation) {
        throw new Error("terminal candidate version selection moved during forge handoff");
      }
    } catch (error) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        reason: "terminal_candidate_binding_moved", message: error?.message ?? String(error)
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
  const closeout = await authenticateWkCloseoutChain({
    mainRepo, wk, candidate: binding.candidate, binding, head: sha, deps
  });
  return closeout === null || closeout.completion !== sha ? null : closeout.completion;
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
  boundaryAuthorization, authentication }) {
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
    ...(authentication === null ? {} : { authentication })
  });
  authenticatedHandoffResults.set(result, Object.freeze({
    binding,
    version_decision: candidateVersionDecision
  }));
  return result;
}

function mintAuthenticatedGitHandoffResult({ identity, authenticatedHead,
  boundaryAuthorization, authentication, effects }) {
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

async function publishGitTransportHandoff({ mainRepo, wk, identity, boundaryAuthorization, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { binding, candidateRecord, destination, remoteUrl, branch, handoffRef, guard } = identity;
  const deliversToRemote = destination.transport === HANDOFF_TRANSPORTS.GIT;
  const remoteRef = `refs/heads/${branch}`;
  const effects = {
    closeout_chain: "existing",
    handoff_ref: "existing",
    destination_branch: deliversToRemote ? "existing" : "not_applicable"
  };
  const authenticate = (sha) => authenticatedBranchHead({ mainRepo, wk, binding, sha, deps });

  let moved = await guard();
  if (moved !== null) return moved;
  const recorded = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit });
  if (recorded.kind === "unobservable") {
    return gitTransportFailure("handoff_ref", "handoff_ref_unobservable", recorded);
  }
  let head = null;
  if (recorded.kind === "present") {
    head = await authenticate(recorded.sha);
    if (head === null) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "handoff_ref", expected: binding.candidate, observed: recorded.sha
      });
    }
  }
  const prepareChain = async () => {
    const prepared = await prepareWkCloseoutChain({
      mainRepo, wk, candidate: binding.candidate, candidateRecord, binding, deps
    });
    if (prepared.ok !== true) return { refusal: closeoutPreparationRefusal(prepared) };
    effects.closeout_chain = "created";
    return { head: prepared.head };
  };

  if (deliversToRemote) {
    moved = await guard();
    if (moved !== null) return moved;
    let observed = observeRemoteRef({ repo: mainRepo, remote: remoteUrl, ref: remoteRef, runGit });
    if (observed.kind === "unobservable") {
      return gitTransportFailure("destination_branch", "destination_branch_unobservable", observed);
    }
    if (observed.kind === "present") {
      const remoteHead = await authenticate(observed.sha);
      if (remoteHead === null || (head !== null && remoteHead !== head)) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "destination_branch", expected: head ?? binding.candidate, observed: observed.sha
        });
      }
      head = remoteHead;
    } else {
      if (head === null) {
        const prepared = await prepareChain();
        if (prepared.refusal !== undefined) return prepared.refusal;
        head = prepared.head;
      }
      moved = await guard();
      if (moved !== null) return moved;
      const pushed = publishRemoteRefIfAbsent({
        repo: mainRepo, remote: remoteUrl, ref: remoteRef, commit: head, runGit
      });
      moved = await guard();
      if (moved !== null) return moved;
      observed = observeRemoteRef({ repo: mainRepo, remote: remoteUrl, ref: remoteRef, runGit });

      if (recorded.kind === "absent" && observed.kind === "present" && observed.sha !== head &&
          await authenticate(observed.sha) !== null) {
        head = observed.sha;
      }
      if (observed.kind !== "present" || observed.sha !== head) {
        if (pushed.kind !== "published") {
          return gitTransportFailure("destination_branch", "destination_publication_failed", pushed);
        }
        return gitTransportFailure("destination_branch", "candidate_not_observable_after_publication",
          observed);
      }
      if (pushed.kind === "published") effects.destination_branch = "published";
    }
  } else if (head === null) {
    const prepared = await prepareChain();
    if (prepared.refusal !== undefined) return prepared.refusal;
    head = prepared.head;
  }

  if (recorded.kind === "absent") {
    moved = await guard();
    if (moved !== null) return moved;
    const created = createLocalRefIfAbsent({
      repo: mainRepo, ref: handoffRef, commit: head, runGit,
      message: `${wk}: hand off exact terminal candidate ${binding.candidate}`
    });
    if (created.kind === "created") {
      effects.handoff_ref = "created";
    } else {

      const again = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit });
      const recovered = again.kind === "present" ? await authenticate(again.sha) : null;
      if (recovered === null || (deliversToRemote && recovered !== head)) {
        return gitTransportFailure("handoff_ref", "handoff_ref_creation_failed", created);
      }
      head = recovered;
    }
  }
  moved = await guard();
  if (moved !== null) return moved;
  return {
    ok: true,
    result: mintAuthenticatedGitHandoffResult({
      identity, authenticatedHead: head, boundaryAuthorization, authentication: null, effects
    })
  };
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

export async function publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps = {} }) {
  try {
    const resolved = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps });
    if (resolved.ok !== true) return resolved;
    if (resolved.unauthenticatedForge !== undefined) {
      const probe = resolved.unauthenticatedForge;
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk,
        initiative: resolved.initiative,
        reason: probe.state === "error" ? probe.reason : "authenticated_forge_required_for_terminal_candidate"
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

    let moved = await guard();
    if (moved !== null) return moved;
    let branchObservation = await forge.observeRemoteBranch({ branch });
    let authenticatedHead = null;
    moved = await guard();
    if (moved !== null) return moved;
    if (branchObservation?.kind === "present") {
      authenticatedHead = await authenticatedBranchHead({
        mainRepo, wk, binding, sha: branchObservation.sha, deps
      });
      if (authenticatedHead === null) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "branch", expected: binding.candidate, observed: branchObservation.sha
        });
      }
    } else if (branchObservation?.kind === "absent") {

      const prepared = await prepareWkCloseoutChain({
        mainRepo, wk, candidate: binding.candidate, candidateRecord, binding, deps
      });
      if (prepared.ok !== true) return closeoutPreparationRefusal(prepared);
      authenticatedHead = prepared.head;
      moved = await guard();
      if (moved !== null) return moved;
      await forge.publishBranchIfAbsent({ branch, commit: authenticatedHead });
      moved = await guard();
      if (moved !== null) return moved;
      branchObservation = await forge.observeRemoteBranch({ branch });
      moved = await guard();
      if (moved !== null) return moved;

      if (branchObservation?.kind === "present" && branchObservation.sha !== authenticatedHead &&
          await authenticatedBranchHead({ mainRepo, wk, binding, sha: branchObservation.sha, deps }) !== null) {
        authenticatedHead = branchObservation.sha;
      }
      if (branchObservation?.kind !== "present" || branchObservation.sha !== authenticatedHead) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
          stage: "branch", reason: "candidate_not_observable_after_publication"
        });
      }
    } else {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable"
      });
    }

    moved = await guard();
    if (moved !== null) return moved;
    let observedPrs = await observeExactPullRequests({ forge, repository, base: landing, head: branch });
    moved = await guard();
    if (moved !== null) return moved;
    if (observedPrs.ok !== true) return pullRequestObservationRefusal(observedPrs);
    if (observedPrs.matches.length === 0) {
      moved = await guard();
      if (moved !== null) return moved;

      let createPullRequestError = null;
      try {
        await forge.createPullRequest({
          base: landing,
          head: branch,
          title: `${wk}: ${String(candidateRecord.title ?? "terminal candidate").trim()}`,
          body: `Exact validated terminal candidate ${binding.candidate} for ${wk}; reviewer and redteam evidence is advisory.\n`
        });
      } catch (error) {

        createPullRequestError = error;
      }
      moved = await guard();
      if (moved !== null) return moved;
      observedPrs = await observeExactPullRequests({ forge, repository, base: landing, head: branch });
      moved = await guard();
      if (moved !== null) return moved;
      if (observedPrs.ok !== true) {
        return pullRequestObservationRefusal(observedPrs, {
          after_create: true,
          create_outcome: createPullRequestError === null ? "returned" : "threw"
        });
      }
      if (observedPrs.matches.length > 1) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "pull_request",
          reason: "multiple_exact_pull_requests_after_create",
          matched: observedPrs.matches.length
        });
      }
      if (observedPrs.matches.length !== 1) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
          stage: "pull_request",
          reason: "pull_request_not_exactly_observable_after_create",
          create_outcome: createPullRequestError === null ? "returned" : "threw"
        });
      }
    }
    if (branchObservation.sha !== authenticatedHead) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "pull_request",
        reason: "pull_request_head_sha_disagrees",
        expected: authenticatedHead,
        observed: branchObservation.sha
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
        boundaryAuthorization: policy.authorization,
        authentication: null
      })
    };
  } catch (error) {
    if (error instanceof WkCloseoutObservationError) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, wkCloseoutObservationDetail(error));
    }
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      reason: "terminal_candidate_publication_threw"
    });
  }
}

async function observeExistingPublication({ mainRepo, wk, candidateState, deps }) {
  try {
    const resolved = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps });
    if (resolved.ok !== true) return resolved;
    if (resolved.unauthenticatedForge !== undefined) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "forge", reason: "authenticated_forge_required_for_existing_publication"
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
    if (branchObservation?.kind === "present") {
      observedHead = branchObservation.sha;
    } else if (branchObservation?.kind === "absent" && observedPrs.matches.length === 1 &&
        observedPrs.matches[0].merged === true) {
      observedHead = observedPrs.matches[0].head_sha;
    } else if (branchObservation?.kind === "absent") {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        stage: "branch", reason: "existing_publication_absent"
      });
    } else {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable"
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
        authentication: "observed_existing_publication"
      })
    };
  } catch (error) {
    if (error instanceof WkCloseoutObservationError) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, wkCloseoutObservationDetail(error));
    }
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      reason: "existing_publication_observation_threw"
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
    if (typeof error?.details?.expected_tip === "string" &&
        typeof error?.details?.actual_tip === "string") {
      return Object.freeze({ ok: false, reason: "terminal_candidate_binding_moved" });
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
          return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
            reason: generationAuthority.reason
          });
        }
        return publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps });
      }
    });
  } catch (error) {
    if (resolutionFailure !== null && error === resolutionFailure.error) throw error;
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "controlled_contract_generation_authority_refused"
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
      reason: typeof error?.code === "string" ? error.code : "controlled_contract_wk_authority_context_invalid"
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
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        reason: generationAuthority.reason
      });
    }
    return observeExistingPublication({ mainRepo, wk, candidateState, deps });
  }
}

function buildResult(kind, fields) {
  return Object.freeze({
    schema_version: WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
    kind,
    ...fields,
    ...(fields.repository ? { repository: Object.freeze({ ...fields.repository }) } : {})
  });
}
