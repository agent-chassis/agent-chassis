import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, renameSync, openSync, closeSync, statSync, fstatSync } from "node:fs";
import path from "node:path";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";
import { observeForgeLandedPublication } from "./wk-forge-landed-publication.mjs";
import {
  assertAuthenticatedWkForgeHandoffResult,
  authenticateWkCloseoutChain,
  buildGhForge,
  readLocalWkAtomically,
  safeLocalWkPath,
  WkCloseoutObservationError,
  wkCloseoutObservationDetail
} from "./wk-forge-handoff.mjs";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest
} from "../../../wiki-core/src/lib/work-record-schema.mjs";
import { authenticateCurrentControlledContractGenerationAtW } from
  "./controlled-carrier-attachment-primitive.mjs";
import { withControlledContractAuthorityExclusion } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

export function defaultRunGit({ repo, args, env = null }) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env: env === null ? process.env : { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024
  });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function defaultRunGh({ args, cwd = null }) {
  const result = spawnSync("gh", args, { cwd: cwd ?? undefined, encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function resolveCanonicalForgeRepository({ repo, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  try {
    const fetchResult = await runGit({ repo, args: ["remote", "get-url", "--all", "origin"] });
    const pushResult = await runGit({ repo, args: ["remote", "get-url", "--push", "--all", "origin"] });
    const rewrites = await runGit({ repo, args: ["config", "--get-regexp", "^url\\." ] });
    const fetchUrls = fetchResult.stdout.trim().split("\n").filter(Boolean);
    const pushUrls = pushResult.stdout.trim().split("\n").filter(Boolean);
    if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0] || rewrites?.stdout?.trim()) return { ok: false, reason: "remote_identity_unproven" };
    const parsed = new URL(fetchUrls[0]);
    const parts = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/u, "").split("/");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
        !/^\/[^/]+\/[^/]+(?:\.git)?$/u.test(parsed.pathname) || parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: "remote_not_canonical" };
    }
    return { ok: true, repository: { host: parsed.hostname, owner: parts[0], name: parts[1], https_url: fetchUrls[0] } };
  } catch { return { ok: false, reason: "remote_unreadable" }; }
}

async function readCandidateBoundRecord({ mainRepo, wk, binding, deps = {} }) {
  try {
    const raw = await run(deps.runGit ?? defaultRunGit, mainRepo,
      ["show", `${binding.candidate}:wiki/work-records/${wk}.json`]);
    const record = jsonRecord(raw, "candidate record unreadable");
    return record.id === wk ? { ok: true, record } : { ok: false, reason: "candidate_record_identity_mismatch" };
  } catch {
    return { ok: false, reason: "candidate_record_unreadable" };
  }
}

export const WK_FORGE_MERGE_RESULT_SCHEMA_VERSION = "agent_launch.wk_forge_merge_result.v1";
export const WK_FORGE_MERGE_FAILURE_CATEGORIES = Object.freeze({
  REQUEST_INVALID: "request_invalid",
  ELIGIBILITY: "eligibility",
  IDENTITY: "identity_disagreement",
  FORGE: "forge_merge_failed",
  RECONCILIATION: "local_reconciliation_failed",
  INDETERMINATE: "indeterminate"
});

const WK_RE = /^WK-\d{4}$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FILE = (wk) => `wiki/work-records/${wk}.json`;
function sameForgeRepository(a, b) {
  return Boolean(a && b && a.host === b.host && a.owner === b.owner && a.name === b.name);
}

function refuse(category, reason, detail = null) {
  return { ok: false, category, detail: { reason, ...(detail ?? {}) } };
}

function reconciliationFailure(reason, completion, carrier = null) {
  const failure = {
    ok: false,
    category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
    partial: true,
    detail: { reason, completion }
  };
  if (carrier !== null) failure.result = carrier;
  return failure;
}

async function run(runGit, repo, args, env = null) {
  const result = await runGit({ repo, args, env });
  if (!result || result.ok !== true) throw new Error(`git ${args[0]} failed`, { cause: result });
  return String(result.stdout ?? "").trim();
}

function jsonRecord(raw, reason) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    throw new Error(reason, { cause: error });
  }
}

function validateWorkRecordShape(record, wk, { closeoutReady = false } = {}) {
  const requiredArrays = ["read_scope", "repo_paths", "write_scope", "depends_on", "blocks", "related", "children"];
  const requiredStrings = ["repo", "title", "record_kind", "work_kind", "priority", "owner", "created", "updated"];
  const statuses = ["todo", "in_progress", "review", "blocked", "done"];
  const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
  const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  return record?.schema_version === "work-record.v1" && record.id === wk &&
    requiredStrings.every((key) => typeof record[key] === "string" && record[key].length > 0) &&
    typeof record.initiative === "string" && /^IN-\d{4}$/u.test(record.initiative) && date(record.created) && date(record.updated) &&
    statuses.includes(record.status) && ["low", "medium", "high", "critical"].includes(record.priority) &&
    requiredArrays.every((key) => stringArray(record[key])) &&
    record.record_kind === "work_item" && record.work_kind === "implementation" &&
    record.acceptance && Array.isArray(record.acceptance.criteria) && Array.isArray(record.acceptance.validation) &&
    record.sections && typeof record.sections === "object" &&
    Array.isArray(record.slices) && record.slices.length > 0 && record.slices.every((slice) => slice &&
      typeof slice.id === "string" && /^SLICE-\d{3}$/u.test(slice.id) &&
      typeof slice.title === "string" && typeof slice.work_kind === "string" &&
      typeof slice.owner === "string" && slice.owner.length > 0 && ["low", "medium", "high", "critical"].includes(slice.priority) &&
      typeof slice.status === "string" && statuses.includes(slice.status) &&
      ["implementation", "review", "redteam"].includes(slice.work_kind) && Array.isArray(slice.depends_on) &&
      stringArray(slice.read_scope) && stringArray(slice.repo_paths) &&
      stringArray(slice.write_scope) && slice.acceptance &&
      stringArray(slice.acceptance.criteria) && stringArray(slice.acceptance.validation) &&
      (slice.review_purpose === undefined ||
        (slice.review_purpose === "terminal_whole_wk" && slice.work_kind === "review"))) &&
    (!closeoutReady || record.status === "review");
}

function validWorkRecord(record, wk, options = {}, deps = {}) {
  if (typeof deps.validateWorkRecord === "function") {
    try {
      const result = deps.validateWorkRecord(record, { id: wk, ...options });
      return result === true || result?.ok === true;
    } catch {
      return false;
    }
  }
  return deps.allowCompatibilityValidator === true && validateWorkRecordShape(record, wk, options);
}

async function commitChain(runGit, mainRepo, head, wk, { deps = {}, candidate, binding = null } = {}) {
  const chain = await authenticateWkCloseoutChain({
    mainRepo, wk, candidate, binding, head, deps: { runGit }
  });
  if (chain === null || chain.completion !== head) return null;
  let candidateRecord;
  try {
    candidateRecord = jsonRecord(await run(runGit, mainRepo,
      ["show", `${candidate}:${FILE(wk)}`]), "candidate record unreadable");
  } catch (error) {
    throw new WkCloseoutObservationError("record", error);
  }
  if (!validWorkRecord(candidateRecord, wk, {}, deps) ||
      !validWorkRecord(chain.closeoutRecord, wk, { closeoutReady: true }, deps) ||
      !validWorkRecord(chain.doneRecord, wk, {}, deps)) return null;
  return {
    candidate,
    closeout: chain.closeout,
    completion: chain.completion,
    closeoutRecord: chain.closeoutRecord,
    doneRecord: chain.doneRecord
  };
}

function normalizePullRequest(pr, repository) {
  if (!pr || typeof pr !== "object") return null;
  const fullName = pr.repository?.full_name ?? pr.base?.repo?.full_name;
  const [owner, name] = typeof fullName === "string" ? fullName.split("/") : [pr.repository?.owner, pr.repository?.name];

  return { number: pr.number, state: pr.state,
    merged: pr.merged === true || typeof pr.merged_at === "string",
    base_ref: pr.base_ref ?? pr.base?.ref, head_ref: pr.head_ref ?? pr.head?.ref,
    head_sha: pr.head_sha ?? pr.head?.sha,
    repository: { host: pr.repository?.host ?? repository.host, owner, name } };
}

function exactPullRequest(pr, { repository, base, branch, head, openOnly = false }) {
  const normalized = normalizePullRequest(pr, repository);
  const stateKnown = normalized?.state === "open" || normalized?.state === "closed";
  const lifecycleValid = normalized?.state === "open" ? normalized.merged !== true :
    normalized?.state === "closed" && normalized.merged === true;
  return normalized && stateKnown && lifecycleValid && normalized.repository && normalized.repository.host === repository.host &&
    normalized.repository.owner === repository.owner && normalized.repository.name === repository.name &&
    normalized.base_ref === base && normalized.head_ref === branch && normalized.head_sha === head &&
    Number.isSafeInteger(normalized.number) && normalized.number > 0 &&
    (!openOnly || normalized.state === "open")
    ? normalized : null;
}

function mergeResponseCommitSha(mergeResponse) {
  const response = mergeResponse?.response && typeof mergeResponse.response === "object"
    ? mergeResponse.response : mergeResponse;
  const candidates = [
    response?.merge_commit_sha,
    response?.sha,
    response?.merge_commit?.sha,
    mergeResponse?.merge_commit_sha
  ].filter((value) => value !== undefined && value !== null);
  return candidates.length > 0 && candidates.every((value) => value === candidates[0]) &&
    OID_RE.test(candidates[0]) ? candidates[0] : null;
}

async function authoritativeLandedCarrier({
  forge, repository, base, wk, candidate, completion, branch, pullRequestNumber,
  mergeResponseSha = null, deps
}) {
  const landed = await observeForgeLandedPublication({
    forge,
    repository,
    base,
    wk,
    candidate,
    completion,
    branch,
    pullRequestNumber
  });
  if (!landed.ok) {
    return {
      ok: false,
      refusal: refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
        landed.detail?.reason ?? "authoritative_landed_publication_observation_failed", { completion })
    };
  }
  if (mergeResponseSha !== null && landed.result.merge_commit_sha !== mergeResponseSha) {
    return {
      ok: false,
      refusal: refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
        "merge_response_identity_disagrees", {
          completion,
          merge_response_sha: mergeResponseSha,
          observed_merge_commit_sha: landed.result.merge_commit_sha
        })
    };
  }
  const witness = deps.landedPublicationWitness;
  if (witness !== undefined) {
    if (typeof witness !== "function") throw new TypeError("landed publication witness must be a function");
    await witness(landed.result);
  }
  return { ok: true, carrier: landed.result };
}

function reconcileLocalWk(mainRepo, localPath, expectedDigest, mergedBytes) {
  safeLocalWkPath(mainRepo, localPath);
  const currentBytes = readLocalWkAtomically(localPath);
  if (computeWorkRecordSourceDigest(jsonRecord(currentBytes, "local WK record unreadable")) !== expectedDigest) {
    throw new Error("local WK changed after operation");
  }
  const fd = openSync(localPath, "r");
  let replacement = null;
  try {
    const pathStat = statSync(localPath);
    const fdStat = fstatSync(fd);
    const current = readFileSync(fd, "utf8");
    if (pathStat.dev !== fdStat.dev || pathStat.ino !== fdStat.ino ||
        computeWorkRecordSourceDigest(jsonRecord(current, "local WK record unreadable")) !== expectedDigest) {
      throw new Error("local WK changed before reconciliation");
    }
    replacement = `${localPath}.codex-reconcile-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(replacement, mergedBytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(replacement, localPath);
    replacement = null;
  } finally {
    closeSync(fd);
    if (replacement !== null) {
      try { unlinkSync(replacement); } catch {   }
    }
  }
}

async function observePr(forge, args) {
  if (typeof forge.observePullRequest === "function") return normalizePullRequest(await forge.observePullRequest(args), args.repository);
  if (typeof forge.listPullRequestPage !== "function") return null;

  const response = await forge.listPullRequestPage({ ...args, page: 1, per_page: 100 });
  const items = response?.items;
  return Array.isArray(items) && items.length === 1 ? normalizePullRequest(items[0], args.repository) : null;
}

function makeForge({ repository, mainRepo, deps, runGit }) {
  if (deps.forge) return deps.forge;
  const host = repository.host;
  const runGh = deps.runGh ?? defaultRunGh;
  const { owner, name } = repository;
  const api = (args) => runGh({ args: ["api", "--hostname", host, ...args] });
  const hosted = buildGhForge({ repository, mainRepo, deps: { runGh, runGit } });
  return {
    repository,
    probe() {
      const auth = runGh({ args: ["auth", "status", "--hostname", host] });
      if (!auth?.ok) return { state: "unauthenticated" };
    const result = api([`repos/${owner}/${name}`]);
      try {
        const body = JSON.parse(result.stdout);
        return result.ok && body.full_name === `${owner}/${name}` && typeof body.default_branch === "string"
          ? { state: "authenticated", default_branch: body.default_branch } : { state: "error" };
      } catch { return { state: "error" }; }
    },
    observeRemoteBranch({ branch }) {
      const result = api([`repos/${owner}/${name}/git/ref/heads/${branch}`]);
      if (!result?.ok) return { kind: "unprovable" };
      try {
        const sha = JSON.parse(result.stdout)?.object?.sha;
        return OID_RE.test(sha) ? { kind: "present", sha } : { kind: "unprovable" };
      } catch { return { kind: "unprovable" }; }
    },
    async listPullRequestPage({ base, branch, page, per_page }) {
      if (typeof branch !== "string" || branch.length === 0) throw new Error("pull request branch selector unavailable");
      const result = api([`repos/${owner}/${name}/pulls?state=all&base=${base}&head=${owner}:${branch}&page=${page}&per_page=${per_page}`]);
      if (!result?.ok) throw new Error("pull request observation failed");
      const items = JSON.parse(result.stdout);
      return { items, has_next: Array.isArray(items) && items.length >= per_page };
    },
    mergePullRequest({ number, expectedHead }) {
      const result = runGh({ args: ["api", "--hostname", host, "--method", "PUT",
        `repos/${owner}/${name}/pulls/${number}/merge`, "-f", "merge_method=merge",
        "-f", `sha=${expectedHead}`] });
      if (!result || result.ok !== true) return { ok: false };
      try {
        const response = JSON.parse(result.stdout);
        return { ok: true, merged: response.merged === true, response };
      } catch { return { ok: false }; }
    },

    observeLandedPullRequest: hosted.observeLandedPullRequest,
    observeExactHeadLanding: hosted.observeExactHeadLanding,
    async readMergedWk({ branch, wk }) {
      const result = api([`repos/${owner}/${name}/contents/${FILE(wk)}?ref=${branch}`]);
      if (!result?.ok) throw new Error("merged record unavailable");
      const body = JSON.parse(result.stdout);
      if (typeof body.content !== "string") throw new Error("merged record content unavailable");
      return Buffer.from(body.content.replace(/\s+/gu, ""), "base64").toString("utf8");
    }
  };
}

function handoffObservationDeps(deps) {
  const selected = {};
  for (const key of ["forge", "runGit", "runGh", "resolveCapturedWkBase"]) {
    if (deps[key] !== undefined) selected[key] = deps[key];
  }
  return Object.freeze(selected);
}

async function runWkForgeMergeWithinGenerationAuthority({
  mainRepo, assignedUnit, authorityContext, deps
}) {
  const wk = assignedUnit;
  const runGit = deps.runGit ?? defaultRunGit;
  let candidateState;
  try {

    const handoff = deps.authenticatedHandoffResult ??
      (typeof deps.resolveAuthenticatedWkForgeHandoff === "function"
        ? await deps.resolveAuthenticatedWkForgeHandoff(wk, authorityContext, handoffObservationDeps(deps))
        : null);
    if (handoff?.ok === false) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
        "authenticated_handoff_unavailable", {
          handoff_refusal: { category: handoff.category ?? null, detail: handoff.detail ?? null }
        });
    }
    if (handoff !== null && handoff !== undefined) {
      try {
        const authenticatedHandoff = handoff?.ok === true ? handoff.result : handoff;
        const retainedHandoff = assertAuthenticatedWkForgeHandoffResult(authenticatedHandoff);
        if (authenticatedHandoff.assigned_unit !== wk ||
            authenticatedHandoff.terminal_candidate !== retainedHandoff.binding?.candidate ||
            authenticatedHandoff.version_identity !== retainedHandoff.version_decision?.version_identity ||
            authenticatedHandoff.immutable_version_ref !== retainedHandoff.version_decision?.immutable_version_ref ||
            authenticatedHandoff.current_selection_observation !==
              retainedHandoff.version_decision?.current_selection_observation) {
          return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
            "authenticated_handoff_identity_disagrees");
        }

        if (authenticatedHandoff.transport !== "hosted") {
          return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY,
            "forge_merge_requires_hosted_handoff", { transport: authenticatedHandoff.transport });
        }
        candidateState = Object.freeze({
          binding: retainedHandoff.binding,
          version_decision: retainedHandoff.version_decision,
          branch: authenticatedHandoff.branch,
          base_branch: authenticatedHandoff.base_branch,
          authenticated_handoff_result: authenticatedHandoff
        });
      } catch {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
          "authenticated_handoff_unverified");
      }
    } else {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
        "authenticated_handoff_result_unavailable");
    }
    const binding = candidateState?.binding;
    if (!binding || binding.canonical_wk_id !== wk || !OID_RE.test(binding.candidate)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "exact_terminal_candidate_unavailable");
    }
    if (binding.main_repo !== undefined && binding.main_repo !== mainRepo) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_repository_disagrees");
    }
    try {
      await authenticateCurrentControlledContractGenerationAtW({
        repoRoot: mainRepo,
        wkId: wk,
        expectedWkTipSha: binding.wk_tip,
        expectedGeneration: binding.controlled_generation,
        deps: { runGit }
      });
    } catch {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
        "controlled_generation_identity_unverified");
    }
    try {
      const verify = deps.verifyTerminalCandidateBinding ?? verifyTerminalWkCandidateObjectBinding;
      await verify({ binding, runGit });
    } catch {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_binding_unverified");
    }
    const candidate = binding.candidate;
    const candidateRecord = await readCandidateBoundRecord({ mainRepo, wk, binding, deps });
    if (!candidateRecord.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, candidateRecord.reason);
    const localPath = path.join(mainRepo, FILE(wk));
    try { safeLocalWkPath(mainRepo, localPath); } catch {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "unsafe_local_WK_path");
    }
    const localBytes = readLocalWkAtomically(localPath);
    const localDigest = computeWorkRecordSourceDigest(jsonRecord(localBytes, "local WK record unreadable"));
    const localRecord = jsonRecord(localBytes, "local WK record unreadable");
    const localAlreadyDone = localRecord.status === "done";
    if (!localAlreadyDone && !validWorkRecord(localRecord, wk, { closeoutReady: true }, deps)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_closeout_ready");
    }
    const remote = await resolveCanonicalForgeRepository({ repo: mainRepo, deps });
    if (!remote.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, remote.reason);
    const forge = makeForge({ repository: remote.repository, mainRepo, deps, runGit });
    if (!sameForgeRepository(forge.repository, remote.repository)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "forge_repository_identity_disagrees");
    }
    const probe = typeof forge.probe === "function" ? forge.probe() : { state: "authenticated", default_branch: deps.baseBranch };
    if (probe?.state !== "authenticated" || typeof probe.default_branch !== "string") {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "forge_unauthenticated_or_base_unknown");
    }

    const configuredBase = candidateState.base_branch ?? candidateState.baseBranch;
    const base = typeof configuredBase === "string" && configuredBase.length > 0 ? configuredBase : probe.default_branch;
    if (base !== probe.default_branch && typeof configuredBase !== "string") {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "configured_base_branch_untrusted");
    }
    const initiative = localRecord.initiative;
    if (typeof initiative !== "string" || !/^IN-\d{4}$/u.test(initiative)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_initiative_unavailable");
    }
    const branch = candidateState.branch ?? `handoff/wk/${initiative}/${wk}/${candidate}`;
    const observation = typeof forge.observeRemoteBranch === "function"
      ? await forge.observeRemoteBranch({ branch }) : null;
    let completion = observation?.kind === "present" && OID_RE.test(observation.sha) ? observation.sha : null;
    let chain = completion && completion !== candidate
      ? await commitChain(runGit, mainRepo, completion, wk, { deps, candidate, binding }) : null;
    let pr = await observePr(forge, { repository: remote.repository, base, branch });
    if (completion === null) {
      if (pr?.merged === true && OID_RE.test(pr.head_sha)) completion = pr.head_sha;
      else return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "handoff_branch_unobservable");
      chain = await commitChain(runGit, mainRepo, completion, wk, { deps, candidate, binding });
    }

    if (!chain || chain.candidate !== candidate) {

      const mergedPr = await observePr(forge, { repository: remote.repository, base, branch });
      if (mergedPr?.merged === true && OID_RE.test(mergedPr.head_sha)) {
        completion = mergedPr.head_sha;
        chain = await commitChain(runGit, mainRepo, completion, wk, { deps, candidate, binding });
      }
    }
    if (!chain || chain.candidate !== candidate) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "handoff_head_is_not_authenticated_closeout_chain");
    }
    pr = await observePr(forge, { repository: remote.repository, base, branch });
    const exact = exactPullRequest(pr, { repository: remote.repository, base, branch, head: completion, openOnly: pr?.merged !== true });
    if (!exact) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "pull_request_head_or_state_disagrees");
    }
    if (localAlreadyDone && exact.merged !== true) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_closeout_ready");
    }

    const localReviewDisagrees = !localAlreadyDone &&
      (!chain.closeoutRecord || computeWorkRecordSourceDigest(chain.closeoutRecord) !== localDigest);
    if (localReviewDisagrees && exact.merged !== true) {
      return reconciliationFailure("local_reconciliation_failed", completion);
    }
    let mergeResponseSha = null;
    if (exact.merged !== true) {
      const merged = await forge.mergePullRequest({ number: exact.number, expectedHead: completion });
      if (!merged || merged.ok !== true || merged.merged !== true) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE, "exact_head_merge_refused", { completion });
      }
      mergeResponseSha = mergeResponseCommitSha(merged);
      if (mergeResponseSha === null) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
          "merge_response_identity_unavailable", { completion });
      }
    }
    const landed = await authoritativeLandedCarrier({
      forge,
      repository: remote.repository,
      base,
      wk,
      candidate,
      completion,
      branch,
      pullRequestNumber: exact.number,
      mergeResponseSha,
      deps
    });
    if (!landed.ok) return landed.refusal;
    const carrier = landed.carrier;
    if (localReviewDisagrees) {
      return reconciliationFailure("local_reconciliation_failed", completion, carrier);
    }
    if (localAlreadyDone) {
      if (!chain.doneRecord || computeWorkRecordSourceDigest(chain.doneRecord) !== localDigest) {
        return reconciliationFailure("local_reconciliation_failed", completion, carrier);
      }
      return { ok: true, result: carrier };
    }
    let currentLocalDigest;
    try {
      safeLocalWkPath(mainRepo, localPath);
      currentLocalDigest = computeWorkRecordSourceDigest(jsonRecord(readFileSync(localPath, "utf8"), "local WK record unreadable"));
    } catch {
      return reconciliationFailure("local_reconciliation_unsafe_or_unreadable", completion, carrier);
    }
    if (currentLocalDigest !== localDigest) {
      return reconciliationFailure("local_WK_changed_after_operation", completion, carrier);
    }
    let mergedBytes;
    try {
      if (typeof forge.readMergedWk !== "function") throw new Error("merged WK reader unavailable");
      mergedBytes = await forge.readMergedWk({ branch: base, wk });
      const mergedRecord = jsonRecord(mergedBytes, "merged WK record unreadable");
      if (!validWorkRecord(mergedRecord, wk, {}, deps) || mergedRecord.status !== "done") throw new Error("merged WK record is not done");
      reconcileLocalWk(mainRepo, localPath, localDigest, mergedBytes);
    } catch {
      return reconciliationFailure("local_reconciliation_failed", completion, carrier);
    }
    return { ok: true, result: carrier };
  } catch (error) {

    if (error instanceof WkCloseoutObservationError) {
      const { reason, ...detail } = wkCloseoutObservationDetail(error);
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.INDETERMINATE, reason, detail);
    }
    return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.INDETERMINATE, "forge_merge_operation_failed");
  }
}

export async function defaultWkForgeMerge({ mainRepo, assignedUnit, deps = {} } = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      !WK_RE.test(assignedUnit ?? "")) {
    return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.REQUEST_INVALID, "invalid_request");
  }
  try {
    return await withControlledContractAuthorityExclusion({
      repoRoot: mainRepo,
      wkId: assignedUnit,
      run: async (authorityContext) => runWkForgeMergeWithinGenerationAuthority({
        mainRepo,
        assignedUnit,
        authorityContext,
        deps
      })
    });
  } catch {
    return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY,
      "controlled_generation_authority_unavailable");
  }
}

export const trustedWkForgeMerge = defaultWkForgeMerge;
