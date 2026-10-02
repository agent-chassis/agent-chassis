

import { withControlledContractAuthorityExclusion } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import {
  assertAuthenticatedWkForgeHandoffResult,
  buildGhForge,
  defaultRunGit
} from "./wk-forge-handoff.mjs";
import {
  HANDOFF_TRANSPORTS,
  isAncestor,
  observeLandingBaseTip,
  observeRemoteRef
} from "./wk-handoff-destination.mjs";

export const FORGE_LANDED_PUBLICATION_SCHEMA_VERSION =
  "forge-confirmed-landed-publication-identity.v1";
export const GIT_LANDED_PUBLICATION_SCHEMA_VERSION = "git-landed-publication-identity.v1";
export const WK_LANDING_OBSERVATION_SCHEMA_VERSION = "wk-landing-observation.v1";

export const WK_LANDING_STATES = Object.freeze({
  AWAITING_HUMAN_LANDING: "awaiting_human_landing",
  LANDED: "landed",
  CONTRADICTORY: "contradictory",
  UNAVAILABLE: "unavailable"
});

export const FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES = Object.freeze({
  REQUEST_INVALID: "request_invalid",
  IDENTITY: "identity_disagreement",
  OBSERVATION: "authoritative_observation_failed"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const WK_RE = /^WK-\d{4}$/u;

function refuse(reason, category = FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.IDENTITY, facts = {}) {
  return { ok: false, category, detail: { reason, ...facts } };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validRepository(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.host === "string" && value.host.length > 0 &&
    typeof value.owner === "string" && value.owner.length > 0 &&
    typeof value.name === "string" && value.name.length > 0;
}

function sameRepository(left, right) {
  return validRepository(left) && validRepository(right) &&
    left.host === right.host && left.owner === right.owner && left.name === right.name;
}

function projectRepository(value) {
  return { host: value.host, owner: value.owner, name: value.name };
}

function aliasValue(values) {
  const present = values.filter((value) => value !== undefined && value !== null);
  if (present.length === 0) return { present: false, value: null, contradictory: false };
  return {
    present: true,
    value: present[0],
    contradictory: present.some((value) => value !== present[0])
  };
}

function repositoryFromPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fullName = value.full_name;
  if (typeof fullName !== "string") return null;
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) return null;
  const owner = aliasValue([
    typeof value.owner === "string" ? value.owner : value.owner?.login,
    value.owner_login
  ]);
  const name = aliasValue([value.name, value.repo_name]);
  if (owner.contradictory || name.contradictory ||
      (owner.present && owner.value !== parts[0]) ||
      (name.present && name.value !== parts[1]) ||
      typeof value.host !== "string" || value.host.length === 0) return null;
  return { host: value.host, owner: parts[0], name: parts[1] };
}

function authoritativeRepository(pr) {
  const directPresent = pr.repository !== undefined && pr.repository !== null;
  const basePresent = pr.base?.repo !== undefined && pr.base?.repo !== null;
  const direct = directPresent ? repositoryFromPayload(pr.repository) : null;
  const base = basePresent ? repositoryFromPayload(pr.base.repo) : null;
  if ((directPresent && direct === null) || (basePresent && base === null)) {
    return { ok: false, reason: "repository_identity_invalid" };
  }
  if (direct !== null && base !== null && !sameRepository(direct, base)) {
    return { ok: false, reason: "contradictory_aliases" };
  }
  const repository = direct ?? base;
  return repository === null
    ? { ok: false, reason: "repository_identity_missing" }
    : { ok: true, repository };
}

function forgeIdentity(pr) {
  const explicit = pr.forge_identity;
  const nodeId = pr.node_id;
  const numericId = pr.id;
  const preferred = nodeId ?? numericId;
  if (explicit !== undefined && explicit !== null && preferred !== undefined &&
      preferred !== null && explicit !== preferred) {
    return { ok: false, reason: "contradictory_aliases" };
  }
  const identity = explicit ?? preferred;
  return (typeof identity === "string" && identity.length > 0) ||
    (Number.isSafeInteger(identity) && identity > 0)
    ? { ok: true, identity }
    : { ok: false, reason: "pull_request_forge_identity_invalid" };
}

function normalizeObservation(pr) {
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
    return { ok: false, reason: "authoritative_observation_unavailable",
      evidence: captureDiagnosticEvidence(pr) };
  }
  if (pr.kind === "ambiguous") return { ok: false, reason: "pull_request_ambiguous" };
  if (pr.kind === "missing") return { ok: false, reason: "pull_request_observation_missing" };

  const repository = authoritativeRepository(pr);
  if (!repository.ok) return repository;
  const identity = forgeIdentity(pr);
  if (!identity.ok) return identity;

  const aliases = {
    number: aliasValue([pr.number, pr.pull_request_number]),
    state: aliasValue([pr.state, pr.status]),
    baseRef: aliasValue([pr.base_ref, pr.base?.ref]),
    headRef: aliasValue([pr.head_ref, pr.head?.ref]),
    headSha: aliasValue([pr.head_sha, pr.head?.sha]),
    mergeSha: aliasValue([pr.merge_commit_sha, pr.merge_commit?.sha]),
    binding: aliasValue([pr.observation_binding, pr.etag, pr.observation_id])
  };
  if (Object.values(aliases).some((alias) => alias.contradictory)) {
    return { ok: false, reason: "contradictory_aliases" };
  }
  if (pr.merged === false && typeof pr.merged_at === "string") {
    return { ok: false, reason: "contradictory_aliases" };
  }
  const binding = aliases.binding.value;
  if (typeof binding !== "string" || binding.length === 0) {
    return { ok: false, reason: "observation_binding_missing" };
  }
  return {
    ok: true,
    observation: {
      number: aliases.number.value,
      forgeIdentity: identity.identity,
      state: aliases.state.value,
      merged: pr.merged === true || (pr.merged === undefined && typeof pr.merged_at === "string"),
      baseRef: aliases.baseRef.value,
      headRef: aliases.headRef.value,
      headSha: aliases.headSha.value,
      mergeSha: aliases.mergeSha.value,
      binding,
      repository: repository.repository,
      embeddedLanding: pr.exact_head_landing ?? null
    }
  };
}

function validRequest({ forge, repository, base, wk, candidate, completion, branch, pullRequestNumber }) {
  const expectedBranch = typeof wk === "string" && typeof candidate === "string"
    ? new RegExp(`^handoff/wk/IN-\\d{4}/${wk}/${candidate}$`, "u")
    : null;
  return forge && typeof forge === "object" && validRepository(repository) &&
    typeof base === "string" && base.length > 0 && WK_RE.test(wk ?? "") &&
    OID_RE.test(candidate ?? "") && OID_RE.test(completion ?? "") &&
    typeof branch === "string" && expectedBranch?.test(branch) === true &&
    Number.isSafeInteger(pullRequestNumber) && pullRequestNumber > 0;
}

function exactLanding(result, observation) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.ok !== true) {
    return { ok: false, reason: "exact_head_ancestry_unproven" };
  }
  const ancestor = aliasValue([result.ancestor, result.ancestor_sha, result.head_sha]);
  const descendant = aliasValue([result.descendant, result.descendant_sha, result.merge_commit_sha]);
  const binding = aliasValue([result.observation_binding, result.etag, result.observation_id]);
  if (ancestor.contradictory || descendant.contradictory || binding.contradictory) {
    return { ok: false, reason: "contradictory_aliases" };
  }
  if (typeof binding.value !== "string" || binding.value.length === 0) {
    return { ok: false, reason: "observation_binding_missing" };
  }
  if (binding.value !== observation.binding) {
    return { ok: false, reason: "observation_binding_mismatch" };
  }
  const relationPresent = result.relation !== undefined && result.relation !== null;
  const booleanPresent = result.is_ancestor !== undefined && result.is_ancestor !== null;
  const relationLanded = ["ancestor", "exact-head-ancestor"].includes(result.relation);
  if (relationPresent && booleanPresent && relationLanded !== (result.is_ancestor === true)) {
    return { ok: false, reason: "contradictory_aliases" };
  }
  if (ancestor.value !== observation.headSha || descendant.value !== observation.mergeSha ||
      !(relationLanded || result.is_ancestor === true)) {
    return { ok: false, reason: "exact_head_ancestry_unproven" };
  }
  return { ok: true };
}

export async function observeForgeLandedPublication({
  forge, repository, base, wk, candidate, completion, branch, pullRequestNumber
} = {}) {
  if (!validRequest({ forge, repository, base, wk, candidate, completion, branch, pullRequestNumber })) {
    return refuse("invalid_request", FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.REQUEST_INVALID);
  }

  try {
    if (typeof forge.observeLandedPullRequest !== "function") {
      return refuse("landed_pull_request_observer_unavailable",
        FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.OBSERVATION);
    }
    const normalized = normalizeObservation(await forge.observeLandedPullRequest({
      repository, base, wk, candidate, completion, branch, number: pullRequestNumber
    }));
    if (!normalized.ok) {
      const { ok: _ok, reason, ...facts } = normalized;
      const observationReasons = new Set([
        "authoritative_observation_unavailable",
        "pull_request_observation_missing"
      ]);
      return refuse(reason, observationReasons.has(reason)
        ? FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.OBSERVATION
        : FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.IDENTITY, facts);
    }
    const observation = normalized.observation;
    if (!sameRepository(observation.repository, repository)) return refuse("wrong_repository");
    if (observation.baseRef !== base) return refuse("wrong_base");
    if (observation.headRef !== branch || observation.headSha !== completion) return refuse("wrong_head");
    if (observation.state !== "closed" || observation.merged !== true) return refuse("pull_request_not_merged");
    if (observation.number !== pullRequestNumber) return refuse("pull_request_number_mismatch");
    if (!OID_RE.test(observation.mergeSha ?? "")) return refuse("merge_commit_sha_invalid");

    let landing = observation.embeddedLanding;
    if (landing === null) {
      if (typeof forge.observeExactHeadLanding !== "function") {
        return refuse("exact_head_landing_observer_unavailable",
          FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.OBSERVATION);
      }
      landing = await forge.observeExactHeadLanding({
        repository,
        base,
        branch,
        head: completion,
        merge_commit_sha: observation.mergeSha,
        observation_binding: observation.binding
      });
    }

    if (landing === null || typeof landing !== "object" || landing.ok !== true) {
      return refuse("exact_head_ancestry_unobservable", FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.OBSERVATION, {
        observation_reason: typeof landing?.reason === "string" ? landing.reason : null,
        evidence: typeof landing?.evidence === "object" && landing.evidence !== null
          ? landing.evidence : captureDiagnosticEvidence(landing)
      });
    }
    const landingResult = exactLanding(landing, observation);
    if (!landingResult.ok) return refuse(landingResult.reason);

    const carrier = {
      schema_version: FORGE_LANDED_PUBLICATION_SCHEMA_VERSION,
      repository: projectRepository(observation.repository),
      base_branch: observation.baseRef,
      wk,
      candidate,
      completion: observation.headSha,
      pull_request: {
        number: observation.number,
        forge_identity: observation.forgeIdentity,
        repository: projectRepository(observation.repository),
        base_ref: observation.baseRef,
        head_ref: observation.headRef,
        head_sha: observation.headSha
      },
      merge_commit_sha: observation.mergeSha,
      exact_head_landing: {
        head_sha: observation.headSha,
        merge_commit_sha: observation.mergeSha,
        relation: "exact-head-ancestor",
        observation_binding: observation.binding
      }
    };
    return { ok: true, result: deepFreeze(carrier) };
  } catch (error) {

    return refuse("authoritative_observation_failed",
      FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.OBSERVATION,
      { evidence: captureDiagnosticEvidence(error) });
  }
}

async function observeGitLanding({ mainRepo, handoff, runGit }) {
  const transport = handoff.transport;
  const remote = handoff.destination?.remote ?? null;
  const base = observeLandingBaseTip({
    repo: mainRepo, transport, remote, baseBranch: handoff.base_branch, runGit
  });
  if (base.kind === "unobservable") {
    return landingOutcome(WK_LANDING_STATES.UNAVAILABLE, {
      cause: { stage: "landing_base", reason: "landing_base_unobservable", evidence: base.evidence }
    });
  }
  if (base.kind === "absent") {
    return landingOutcome(WK_LANDING_STATES.CONTRADICTORY, {
      cause: { stage: "landing_base", reason: "landing_base_absent", ref: base.ref }
    });
  }
  const observedBase = { ref: base.ref, sha: base.sha };
  let landed;
  try {
    landed = isAncestor({ repo: mainRepo, ancestor: handoff.commit, descendant: base.sha, runGit });
  } catch (error) {
    return landingOutcome(WK_LANDING_STATES.UNAVAILABLE, {
      observedBase,
      cause: { stage: "ancestry", reason: "exact_head_ancestry_unobservable",
        evidence: captureDiagnosticEvidence(error) }
    });
  }
  if (landed) {
    return landingOutcome(WK_LANDING_STATES.LANDED, {
      observedBase,
      landedPublication: deepFreeze({
        schema_version: GIT_LANDED_PUBLICATION_SCHEMA_VERSION,
        transport,
        destination: { ...handoff.destination },
        base_branch: handoff.base_branch,
        wk: handoff.assigned_unit,
        candidate: handoff.terminal_candidate,
        completion: handoff.commit,
        landed_commit: base.sha,
        exact_head_landing: {
          head_sha: handoff.commit,
          landed_commit: base.sha,
          relation: "exact-head-ancestor",
          observed_base_ref: base.ref
        }
      })
    });
  }
  if (transport === HANDOFF_TRANSPORTS.GIT) {
    const ref = `refs/heads/${handoff.branch}`;
    const branch = observeRemoteRef({ repo: mainRepo, remote, ref, runGit });
    if (branch.kind === "unobservable") {
      return landingOutcome(WK_LANDING_STATES.UNAVAILABLE, {
        observedBase,
        cause: { stage: "destination_branch", reason: "destination_branch_unobservable", evidence: branch.evidence }
      });
    }
    if (branch.kind === "absent" || branch.sha !== handoff.commit) {
      return landingOutcome(WK_LANDING_STATES.CONTRADICTORY, {
        observedBase,
        cause: {
          stage: "destination_branch",
          reason: branch.kind === "absent"
            ? "destination_branch_absent_without_landing"
            : "destination_branch_moved_without_landing",
          expected: handoff.commit,
          observed: branch.sha ?? null
        }
      });
    }
  }
  return landingOutcome(WK_LANDING_STATES.AWAITING_HUMAN_LANDING, { observedBase });
}

async function observeHostedLanding({ mainRepo, handoff, deps }) {
  if (handoff.pull_request_state !== "already_merged") {
    return landingOutcome(WK_LANDING_STATES.AWAITING_HUMAN_LANDING, {});
  }
  const { host, owner, name } = handoff.repository;
  const repository = { host, owner, name };
  const forge = deps.forge ?? buildGhForge({
    repository: { ...repository, https_url: `https://${host}/${owner}/${name}.git` },
    mainRepo,
    deps
  });
  const landed = await observeForgeLandedPublication({
    forge,
    repository,
    base: handoff.base_branch,
    wk: handoff.assigned_unit,
    candidate: handoff.terminal_candidate,
    completion: handoff.commit,
    branch: handoff.branch,
    pullRequestNumber: handoff.pull_request.number
  });
  if (landed.ok === true) {
    return landingOutcome(WK_LANDING_STATES.LANDED, { landedPublication: landed.result });
  }
  return landingOutcome(
    landed.category === FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.IDENTITY
      ? WK_LANDING_STATES.CONTRADICTORY
      : WK_LANDING_STATES.UNAVAILABLE,
    { cause: { stage: "landed_publication", category: landed.category, ...landed.detail } }
  );
}

function landingOutcome(state, { observedBase = null, landedPublication = null, cause = null }) {
  return { state, observedBase, landedPublication, cause };
}

function projectHandoff(handoff) {
  return {
    terminal_candidate: handoff.terminal_candidate,
    commit: handoff.commit,
    base_branch: handoff.base_branch,
    destination: handoff.destination,
    ...(handoff.transport === HANDOFF_TRANSPORTS.HOSTED
      ? { branch: handoff.branch, pull_request_number: handoff.pull_request?.number ?? null }
      : { handoff_ref: handoff.handoff_ref, branch: handoff.branch })
  };
}

function landingObservation(assignedUnit, { state, handoff = null, outcome = null, cause = null }) {
  return deepFreeze({
    schema_version: WK_LANDING_OBSERVATION_SCHEMA_VERSION,
    assigned_unit: assignedUnit,
    state,
    transport: handoff?.transport ?? null,
    landing_authority: handoff === null
      ? null
      : handoff.transport === HANDOFF_TRANSPORTS.HOSTED
        ? "configured_forge_and_human_merge_actor"
        : "human_git_actor",
    handoff: handoff === null ? null : projectHandoff(handoff),
    observed_base: outcome?.observedBase ?? null,
    landed_publication: outcome?.landedPublication ?? null,
    cause: outcome?.cause ?? cause
  });
}

export async function observeAuthenticatedHandoffLanding({ mainRepo, handoff, deps = {} } = {}) {
  assertAuthenticatedWkForgeHandoffResult(handoff);
  const outcome = handoff.transport === HANDOFF_TRANSPORTS.HOSTED
    ? await observeHostedLanding({ mainRepo, handoff, deps })
    : await observeGitLanding({ mainRepo, handoff, runGit: deps.runGit ?? defaultRunGit });
  return landingObservation(handoff.assigned_unit, { state: outcome.state, handoff, outcome });
}

function landingRequestRefusal(reason, facts) {
  return {
    ok: false,
    category: FORGE_LANDED_PUBLICATION_FAILURE_CATEGORIES.REQUEST_INVALID,
    detail: { reason, ...facts }
  };
}

export async function observeWkHandoffLanding({ mainRepo, assignedUnit, deps = {} } = {}) {
  if (!WK_RE.test(assignedUnit ?? "")) {
    return landingRequestRefusal("assigned_unit_invalid", {
      assigned_unit: typeof assignedUnit === "string" ? assignedUnit : null,
      responsible_actor: "caller_retry",
      prerequisite: "assigned_unit names one WK record (WK-####)"
    });
  }
  if (typeof mainRepo !== "string" || mainRepo.length === 0) {
    return landingRequestRefusal("main_repository_missing", {
      assigned_unit: assignedUnit,
      missing_component: "main_repository",
      responsible_actor: "launcher",
      prerequisite: "the landing observer is composed with the launcher-bound canonical main repository"
    });
  }
  if (typeof deps.observeAuthenticatedHandoff !== "function") {
    return landingRequestRefusal("authenticated_handoff_observer_missing", {
      assigned_unit: assignedUnit,
      missing_component: "deps.observeAuthenticatedHandoff",
      responsible_actor: "launcher",
      prerequisite: "the landing observer is composed with the handoff authority owner's " +
        "authenticated existing-publication observer"
    });
  }
  const runGit = deps.runGit ?? defaultRunGit;
  let observation;
  try {
    observation = await withControlledContractAuthorityExclusion({
      repoRoot: mainRepo,
      wkId: assignedUnit,
      run: async (authorityContext) => {
        const observed = await deps.observeAuthenticatedHandoff(assignedUnit, authorityContext);
        if (observed?.ok !== true) {
          return landingObservation(assignedUnit, {
            state: observed?.category === "publication_disagreement"
              ? WK_LANDING_STATES.CONTRADICTORY
              : WK_LANDING_STATES.UNAVAILABLE,
            cause: {
              stage: "handoff",
              category: observed?.category ?? null,
              detail: observed?.detail ?? null
            }
          });
        }
        return observeAuthenticatedHandoffLanding({ mainRepo, handoff: observed.result, deps: { ...deps, runGit } });
      }
    });
  } catch (error) {
    observation = landingObservation(assignedUnit, {
      state: WK_LANDING_STATES.UNAVAILABLE,
      cause: {
        stage: "observation",
        reason: "landing_observation_failed",
        evidence: captureDiagnosticEvidence(error)
      }
    });
  }
  return { ok: true, result: observation };
}
