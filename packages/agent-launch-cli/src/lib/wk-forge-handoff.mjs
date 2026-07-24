

import { spawnSync } from "node:child_process";
import { computeWorkRecordSourceDigest } from "../../../wiki-core/src/index.mjs";

import {
  WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_RESULT_KINDS,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES,
  WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_POLICY_POSTURES
} from "./trusted-operation-contracts.mjs";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";

export { WK_FORGE_HANDOFF_FAILURE_CATEGORIES };

export const FORGE_LANDING_BRANCH_ENV_VAR = "AGENT_LAUNCH_FORGE_LANDING_BRANCH";

const WK_RECORD_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FORGE_HOST_RE = /^[a-z0-9.-]+$/u;
const FORGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;

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

function buildForgeHandoffPolicyTarget({ binding, initiative, repository, landing, branch }) {
  return Object.freeze({
    operation: "wk_forge_handoff",
    assigned_unit: binding.canonical_wk_id,
    initiative,
    candidate_sha: binding.candidate,
    candidate_tree: binding.candidate_tree,
    candidate_ref: binding.candidate_ref,
    landing_ref: binding.landing_ref,
    landing_sha: binding.landing_tip,
    wk_ref: binding.wk_ref,
    wk_sha: binding.wk_tip,
    canonical_wk_digest: binding.canonical_wk_digest,
    repository: Object.freeze({
      host: repository.host,
      owner: repository.owner,
      name: repository.name
    }),
    base_branch: landing,
    handoff_branch: branch
  });
}

export async function resolveWkForgeHandoffBoundaryAuthorization({
  policy = null,
  binding,
  initiative,
  repository,
  landing,
  branch
} = {}) {
  const target = buildForgeHandoffPolicyTarget({ binding, initiative, repository, landing, branch });
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
  let res;
  try {
    res = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      env: env === null ? process.env : env,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) return { ok: false, error: res.error.message ?? String(res.error) };
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",

      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
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

function git(runGit, repo, args, env = null) {
  const res = runGit({ repo, args, env });
  if (!res || res.ok !== true) {
    const err = new Error(`git ${args[0]} failed`);
    err.git = { args: args.slice(0, 2), status: res?.status ?? null, stderr: res?.stderr ?? null };
    throw err;
  }
  return res.stdout.trim();
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
  const runGit = deps.runGit ?? defaultRunGit;
  if (typeof repo !== "string" || repo.length === 0) {
    return { ok: false, reason: "repo_missing" };
  }
  let fetchUrls;
  let pushUrls;
  let rewrites;
  try {
    fetchUrls = git(runGit, repo, ["remote", "get-url", "--all", remoteName])
      .split("\n").map((line) => line.trim()).filter(Boolean);
    pushUrls = git(runGit, repo, ["remote", "get-url", "--push", "--all", remoteName])
      .split("\n").map((line) => line.trim()).filter(Boolean);

    const res = runGit({ repo, args: ["config", "--get-regexp", "^url\\."], env: null });
    rewrites = res?.ok === true
      ? res.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
  } catch {
    return { ok: false, reason: "remote_unreadable" };
  }
  if (rewrites.length > 0) return { ok: false, reason: "url_rewrite_configured" };
  if (fetchUrls.length !== 1) return { ok: false, reason: "remote_fetch_url_not_unique" };
  if (pushUrls.length !== 1) return { ok: false, reason: "remote_push_url_not_unique" };
  if (fetchUrls[0] !== pushUrls[0]) return { ok: false, reason: "remote_push_url_diverges" };
  const identity = parseHttpsForgeRepositoryUrl(fetchUrls[0]);
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
      const defaultBranch = body?.default_branch;
      if (typeof defaultBranch !== "string" || !BRANCH_RE.test(defaultBranch)) {
        return { state: "error", reason: "default_branch_unobservable" };
      }

      if (typeof body.full_name === "string" && body.full_name !== `${owner}/${name}`) {
        return { state: "error", reason: "repository_identity_mismatch" };
      }
      return { state: "authenticated", default_branch: defaultBranch };
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
    }
  };
}

async function publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const binding = candidateState?.binding;
  const materialization = candidateState?.materialization;
  try {
    if (binding?.canonical_wk_id !== wk) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        reason: "exact_terminal_candidate_unavailable"
      });
    }
    try {
      assertTerminalCandidateMaterialization(materialization, binding);
      verifyTerminalWkCandidateObjectBinding({ binding, runGit });
      verifyTerminalCandidateCheckout({ binding, candidateRoot: materialization.candidate_root, runGit });
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
    const remote = resolveCanonicalForgeRepository({ repo: mainRepo, remoteName: "origin", deps });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { reason: remote.reason });
    }
    const repository = remote.repository;
    const forge = deps.forge ?? buildGhForge({ repository, mainRepo, deps });
    if (!sameForgeRepository(forge.repository, repository)) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { reason: "git_rest_repository_disagreement" });
    }
    const probe = forge.probe();
    if (probe.state !== "authenticated") {
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk,
        initiative,
        reason: probe.state === "error" ? probe.reason : "authenticated_forge_required_for_terminal_candidate"
      }) };
    }
    const landing = probe.default_branch;
    if (`refs/heads/${landing}` !== binding.landing_ref) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        reason: "forge_landing_branch_disagrees_with_terminal_candidate",
        expected: binding.landing_ref,
        observed: landing
      });
    }
    const constraint = (deps.env ?? process.env)[FORGE_LANDING_BRANCH_ENV_VAR];
    if (typeof constraint === "string" && constraint.length > 0 && constraint !== landing) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        reason: "configured_landing_branch_disagrees_with_terminal_candidate"
      });
    }
    const branch = deriveForgeBranchName({ initiative, wk, candidate: binding.candidate });
    const policy = await resolveWkForgeHandoffBoundaryAuthorization({
      policy: deps.forgeHandoffCcePolicy ?? null,
      binding,
      initiative,
      repository,
      landing,
      branch
    });
    if (policy.ok !== true) return policy;
    const boundaryAuthorization = policy.authorization;

    const guard = () => {
      try {
        verifyTerminalWkCandidateObjectBinding({ binding, runGit });
        verifyTerminalCandidateCheckout({ binding, candidateRoot: materialization.candidate_root, runGit });
      } catch (error) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
          reason: "terminal_candidate_binding_moved", message: error?.message ?? String(error)
        });
      }
      return null;
    };

    let moved = guard();
    if (moved !== null) return moved;
    let branchObservation = await forge.observeRemoteBranch({ branch });
    moved = guard();
    if (moved !== null) return moved;
    if (branchObservation?.kind === "present") {
      if (branchObservation.sha !== binding.candidate) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "branch", expected: binding.candidate, observed: branchObservation.sha
        });
      }
    } else if (branchObservation?.kind === "absent") {
      moved = guard();
      if (moved !== null) return moved;
      await forge.publishBranchIfAbsent({ branch, commit: binding.candidate });
      moved = guard();
      if (moved !== null) return moved;
      branchObservation = await forge.observeRemoteBranch({ branch });
      moved = guard();
      if (moved !== null) return moved;
      if (branchObservation?.kind !== "present" || branchObservation.sha !== binding.candidate) {
        return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
          stage: "branch", reason: "candidate_not_observable_after_publication"
        });
      }
    } else {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable"
      });
    }

    moved = guard();
    if (moved !== null) return moved;
    return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF, {
      assigned_unit: wk,
      initiative,
      branch,
      commit: binding.candidate,
      tree: binding.candidate_tree,
      parent: binding.landing_tip,
      base_branch: landing,
      repository: { host: repository.host, owner: repository.owner, name: repository.name },
      boundary_authorization: boundaryAuthorization,
      advisory_review_evidence: candidateState.advisory_review_evidence ?? null,
      proposal_authority: "configured_forge_and_human_merge_actor"
    }) };
  } catch (error) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
      reason: "terminal_candidate_publication_threw",
      message: error?.message ?? String(error)
    });
  }
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
  const candidateState = await deps.resolveTerminalCandidatePublicationState(wk);
  if (candidateState === null || candidateState === undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "exact_terminal_candidate_unavailable"
    });
  }
  return publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps });

}

function buildResult(kind, fields) {
  return Object.freeze({
    schema_version: WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
    kind,
    ...fields,
    ...(fields.repository ? { repository: Object.freeze({ ...fields.repository }) } : {})
  });
}
