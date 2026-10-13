

import {
  runWithControlledContractAuthorityContext,
  withControlledContractAuthorityExclusion
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";
import {
  WK_FORGE_HANDOFF_RESULT_KINDS,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES
} from "./trusted-operation-contracts.mjs";
import {
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  oidReForObjectFormat
} from "./terminal-wk-candidate.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
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
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  WkCloseoutObservationError,
  authenticatedChainAt,
  classifyLiveAgainstPublication,
  closeoutPreparationRefusal,
  commitWkCloseoutChain,
  livePublishedUnchanged,
  readAuthenticatedLiveCloseout,
  readCandidateBoundRecord,
  readLiveWkRecord,
  succeedsPublishedChain,
  underCapturedLiveRecord,
  wkCloseoutObservationDetail
} from "./wk-forge-closeout-chain.mjs";
import { defaultRunGit } from "./wk-forge-command.mjs";
import {
  authenticateExactProposal,
  branchObservationFacts,
  wkProposalDescription,
  wkProposalTitle,
  branchPublicationFacts,
  forgeProbeDiagnostic,
  observeExactPullRequests,
  pullRequestObservationRefusal,
  returnedOutcomeEvidence
} from "./wk-forge-gh-adapter.mjs";
import {
  authenticateForgeGenerationAuthority,
  resolveWkForgeHandoffBoundaryAuthorization
} from "./wk-forge-handoff-authorization.mjs";
import {
  WK_RECORD_RE,
  buildResult,
  gitTransportFailure,
  isPlainObject,
  projectHandoffDestination,
  refuse,
  withEffects
} from "./wk-forge-handoff-refusal.mjs";
import {
  authenticatedBranchHead,
  deriveForgeBranchName,
  resolveCandidatePublicationIdentity
} from "./wk-forge-publication-identity.mjs";

export { WK_FORGE_HANDOFF_FAILURE_CATEGORIES };

export const FORGE_LANDING_BRANCH_ENV_VAR = "AGENT_LAUNCH_FORGE_LANDING_BRANCH";

const authenticatedHandoffResults = new WeakMap();

export function assertAuthenticatedWkForgeHandoffResult(result) {
  const retained = authenticatedHandoffResults.get(result);
  if (retained === undefined || retained.landing_only === true) {
    throw new Error("WK forge handoff result is not launcher-authenticated");
  }
  return retained;
}

export function assertAuthenticatedWkForgeHandoffLandingInput(result) {
  const retained = authenticatedHandoffResults.get(result);
  if (retained === undefined) throw new Error("WK handoff landing input is not owner-authenticated");
  return retained;
}

export function projectAuthenticatedWkPublicationSelection(result) {
  assertAuthenticatedWkForgeHandoffResult(result);
  return Object.freeze({
    kind: "publication", version: result.version_identity, head: result.commit,
    destination: Object.freeze({
      transport: result.transport,
      ...(result.transport === HANDOFF_TRANSPORTS.LOCAL ? {} : { remote: result.destination.remote })
    }),
    ...(result.transport === HANDOFF_TRANSPORTS.HOSTED ? { proposal: result.pull_request.number } : {})
  });
}

const WK_PUBLICATION_SELECTION_VERSION_CONSTRAINT = "selection.version is exactly 64 lowercase " +
  "hexadecimal characters identifying one publication version; copy the complete selection the " +
  "publication owner returned";

export function createWkPublicationSelectionSchema(z) {
  const common = {
    kind: z.literal("publication"),
    version: z.string().regex(/^[0-9a-f]{64}$/u, WK_PUBLICATION_SELECTION_VERSION_CONSTRAINT),
    head: z.string().regex(new RegExp(
      `^(?!0+$)(?:(?:${oidReForObjectFormat("sha1").source})|(?:${oidReForObjectFormat("sha256").source}))$`, "u"))
  };
  return z.union(Object.values(HANDOFF_TRANSPORTS).map((transport) => z.object({
    ...common,
    destination: z.object({ transport: z.literal(transport),
      ...(transport === HANDOFF_TRANSPORTS.LOCAL ? {} : { remote: z.string().min(1) }) }).strict(),
    ...(transport === HANDOFF_TRANSPORTS.HOSTED
      ? { proposal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) } : {})
  }).strict()));
}

export function validateWkPublicationSelection(selection) {
  const invalid = (field) => refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, {
    reason: "publication_selection_invalid", field
  });
  if (!isPlainObject(selection)) return invalid("selection");
  const keys = ["kind", "version", "head", "destination", "proposal"];
  for (const field of Object.keys(selection)) if (!keys.includes(field)) return invalid(`selection.${field}`);
  if (selection.kind !== "publication") return invalid("selection.kind");
  if (typeof selection.version !== "string" || !/^[0-9a-f]{64}$/u.test(selection.version)) {
    return invalid("selection.version");
  }
  if (typeof selection.head !== "string" ||
      !(oidReForObjectFormat("sha1").test(selection.head) || oidReForObjectFormat("sha256").test(selection.head)) ||
      /^0+$/u.test(selection.head)) return invalid("selection.head");
  const destination = selection.destination;
  if (!isPlainObject(destination)) return invalid("selection.destination");
  if (!Object.values(HANDOFF_TRANSPORTS).includes(destination.transport)) {
    return invalid("selection.destination.transport");
  }
  const local = destination.transport === HANDOFF_TRANSPORTS.LOCAL;
  for (const field of Object.keys(destination)) {
    if (!(local ? ["transport"] : ["transport", "remote"]).includes(field)) {
      return invalid(`selection.destination.${field}`);
    }
  }
  if (!local && (typeof destination.remote !== "string" || destination.remote.length === 0)) {
    return invalid("selection.destination.remote");
  }
  if (destination.transport === HANDOFF_TRANSPORTS.HOSTED
      ? !Number.isSafeInteger(selection.proposal) || selection.proposal <= 0
      : Object.hasOwn(selection, "proposal")) return invalid("selection.proposal");
  return { ok: true, selection: Object.freeze({ ...selection, destination: Object.freeze({ ...destination }) }) };
}

const WK_FORGE_HANDOFF_TOOL = "workspace_publish_work";

const LIVE_RECORD_PUBLISHED_FACT = "forge_handoff.live_record_published";

function mintAuthenticatedHandoffResult({ identity, authenticatedHead, pullRequest,
  boundaryAuthorization, authentication, effects, diagnostic = null, landingOnly = false }) {
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
    ...(identity.synchronization == null ? {} : { synchronization: identity.synchronization }),
    ...(authentication === null ? {} : { authentication }),
    ...(diagnostic === null ? {} : { diagnostic })
  });
  authenticatedHandoffResults.set(result, Object.freeze({
    binding,
    version_decision: candidateVersionDecision,
    landing_only: landingOnly
  }));
  return result;
}

function mintAuthenticatedGitHandoffResult({ identity, authenticatedHead,
  boundaryAuthorization, authentication, effects, livePublication = null, landingOnly = false }) {
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
        tool: "workspace_check_landing",
        arguments: Object.freeze({ subject: binding.canonical_wk_id })
      })
    }),
    effects: Object.freeze({ ...effects }),
    ...(identity.synchronization == null ? {} : { synchronization: identity.synchronization }),
    ...(livePublication?.value === undefined ? {} : { live_record_published: livePublication.value }),
    ...(livePublication?.unobserved === undefined ? {}
      : { live_record_published_unobserved: Object.freeze({ ...livePublication.unobserved }) }),
    ...(authentication === null ? {} : { authentication })
  });
  authenticatedHandoffResults.set(result, Object.freeze({
    binding,
    version_decision: candidateVersionDecision,
    landing_only: landingOnly
  }));
  return result;
}

function observeLandedRetry({ mainRepo, wk, landed, binding }) {
  const live = readLiveWkRecord(mainRepo, wk);
  if (live.ok !== true) return { refusal: closeoutPreparationRefusal(live) };
  if (landed.candidate === binding.candidate && livePublishedUnchanged(live, landed)) return { unchanged: true };
  return {
    refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "landing", reason: "published_handoff_already_landed", landed_head: landed.head
    })
  };
}

async function decideHandoffRefresh({ mainRepo, wk, identity, published, deps }) {
  const { binding, candidateRecord } = identity;
  let live;
  if (published.candidate !== binding.candidate) {
    live = readAuthenticatedLiveCloseout({
      mainRepo, wk, candidateRecord, binding, publishedRecord: published.closeoutRecord
    });
    if (live.ok !== true) return { refusal: closeoutPreparationRefusal(live) };
  } else {
    const classified = classifyLiveAgainstPublication({ mainRepo, wk, binding, candidateRecord, published });
    if (classified.kind === "unchanged") {
      return { kind: "unchanged", head: published.head, live: classified.live };
    }
    if (classified.kind === "refused") return { refusal: closeoutPreparationRefusal(classified.cause) };
    ({ live } = classified);
  }
  const built = await commitWkCloseoutChain({
    mainRepo, wk, candidate: binding.candidate, binding, live, deps
  });
  if (built.ok !== true) return { refusal: closeoutPreparationRefusal(built) };
  return { kind: "refresh", head: built.head, live };
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
        arguments: { subject: wk },
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

function listWkCandidateVersions({ mainRepo, wk, initiative, runGit }) {
  const prefix = `${deriveTerminalCandidateDurableRefs({ initiative, canonicalWkId: wk }).candidates_ref}/`;
  return git(runGit, mainRepo, ["for-each-ref", "--format=%(refname) %(objectname)", prefix])
    .split("\n").map((line) => line.trim().split(" ")).filter(([ref]) => Boolean(ref))
    .map(([ref, candidate]) => ({ version: ref.slice(prefix.length), candidate }))
    .filter(({ version }) => /^[0-9a-f]{64}$/u.test(version));
}

function candidateDestinationNames({ identity, wk, candidate }) {
  const { initiative, destination } = identity;
  return {
    candidate,
    branch: deriveForgeBranchName({ initiative, wk, candidate }),
    handoffRef: destination.transport === HANDOFF_TRANSPORTS.HOSTED
      ? null : wkHandoffRef({ initiative, wk, candidate, destination })
  };
}

async function observeDestinationNames({ mainRepo, identity, names, runGit }) {
  if (identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED) {
    const { forge, repository, landing } = identity;
    const branch = await forge.observeRemoteBranch({ branch: names.branch });
    if (branch?.kind !== "present" && branch?.kind !== "absent") {
      return { refusal: refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "branch", reason: "remote_candidate_state_unprovable",
        observation: branchObservationFacts(branch)
      }) };
    }
    const proposals = await observeExactPullRequests({ forge, repository, base: landing, head: names.branch });
    if (proposals.ok !== true) return { refusal: pullRequestObservationRefusal(proposals) };
    return { present: branch.kind === "present" || proposals.matches.length > 0 };
  }
  const recorded = readLocalRef({ repo: mainRepo, ref: names.handoffRef, runGit });
  if (recorded.kind === "unobservable") {
    return { refusal: gitTransportFailure("handoff_ref", "handoff_ref_unobservable", recorded) };
  }
  if (recorded.kind === "present" || identity.destination.transport !== HANDOFF_TRANSPORTS.GIT) {
    return { present: recorded.kind === "present" };
  }
  const remote = observeRemoteRef({
    repo: mainRepo, remote: identity.remoteUrl, ref: `refs/heads/${names.branch}`, runGit
  });
  if (remote.kind === "unobservable") {
    return { refusal: gitTransportFailure("destination_branch", "destination_branch_unobservable", remote) };
  }
  return { present: remote.kind === "present" };
}

async function locateWkPublication({ mainRepo, wk, identity, synchronization = null, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const { binding, initiative } = identity;
  const ownChainAt = (sha) => authenticatedChainAt({ mainRepo, wk, binding, sha, deps });
  const located = (names, chainAt) => ({ ok: true, identity: Object.freeze({
    ...identity,
    ...(names === null ? {} : { branch: names.branch, handoffRef: names.handoffRef }),
    candidate_destination: names?.candidate ?? null,
    chainAt,
    synchronization
  }) });
  const authenticateVersion = deps.observeHistoricalTerminalCandidatePublicationState;
  if (typeof authenticateVersion !== "function") return located(null, ownChainAt);
  let versions;
  try {
    versions = listWkCandidateVersions({ mainRepo, wk, initiative, runGit })
      .filter(({ candidate }) => candidate !== binding.candidate);
  } catch (error) {
    return gitTransportFailure("candidate_versions", "candidate_versions_unobservable", {
      evidence: captureDiagnosticEvidence(error)
    });
  }
  if (versions.length === 0) return located(null, ownChainAt);
  const own = await observeDestinationNames({
    mainRepo, identity, names: candidateDestinationNames({ identity, wk, candidate: binding.candidate }), runGit
  });
  if (own.refusal !== undefined) return own.refusal;
  if (own.present) return located(null, ownChainAt);
  const published = [];
  for (const { candidate } of versions) {
    const names = candidateDestinationNames({ identity, wk, candidate });
    const recorded = listRecordedHandoffs({ repo: mainRepo, initiative, wk, candidate, runGit });
    if (recorded.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
        stage: "handoff_ref", reason: "handoff_ref_unobservable", evidence: recorded.evidence
      });
    }

    const elsewhere = recorded.handoffs.find((handoff) => handoff.ref !== names.handoffRef);
    if (elsewhere !== undefined) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
        stage: "destination",
        reason: "handoff_destination_changed",
        recorded_destination: elsewhere.destination,
        selected_destination: projectHandoffDestination(identity.destination)
      });
    }
    const observed = await observeDestinationNames({ mainRepo, identity, names, runGit });
    if (observed.refusal !== undefined) return observed.refusal;
    if (observed.present) published.push(names);
  }
  if (published.length === 0) return located(null, ownChainAt);
  if (published.length > 1) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "destination",
      reason: "wk_publication_not_unique",
      publications: published.map((names) => ({
        candidate: names.candidate,
        ...(names.handoffRef === null ? { branch: names.branch } : { handoff_ref: names.handoffRef })
      }))
    });
  }

  const versionBeneath = (sha) => {
    let ancestry;
    try {
      ancestry = git(runGit, mainRepo, ["rev-list", "--first-parent", "-n", "3", sha]).split("\n").slice(1);
    } catch (error) {
      throw Object.assign(new WkCloseoutObservationError("candidate_version_ancestry", error), {
        subject: { assigned_unit: wk, head: sha }
      });
    }
    return versions.find(({ candidate }) => ancestry.includes(candidate)) ?? null;
  };
  return located(published[0], async (sha) => {
    const chain = await ownChainAt(sha);
    if (chain !== null) return chain;
    const version = versionBeneath(sha);
    if (version === null) return null;
    const earlier = await authenticateVersion(wk, version.version);
    if (earlier?.binding?.candidate !== version.candidate) return null;
    return authenticatedChainAt({ mainRepo, wk, binding: earlier.binding, sha, deps });
  });
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

async function observeLandedWkPublication({ mainRepo, wk, deps }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const authenticateVersion = deps.observeHistoricalTerminalCandidatePublicationState;
  if (typeof authenticateVersion !== "function") return { landed: null };
  const unobservable = (observation, cause) => ({ unobservable: { observation, ...cause } });
  const refused = (observation, outcome) =>
    unobservable(observation, { cause: outcome.detail ?? { reason: outcome.reason } });
  let observation = "live_record";
  try {
    const live = readLiveWkRecord(mainRepo, wk);
    if (live.ok !== true) return refused(observation, live);
    observation = "candidate_versions";
    const versions = listWkCandidateVersions({ mainRepo, wk, initiative: live.record.initiative, runGit });
    if (versions.length === 0) return { landed: null };
    const selected = readLocalRef({
      repo: mainRepo, ref: deriveTerminalCandidateCurrentRef({ canonicalWkId: wk }), runGit
    });
    const version = versions.find(({ candidate }) => candidate === selected.sha) ?? versions[0];
    observation = "destination";
    const destination = resolveHandoffDestination({ repo: mainRepo, runGit });
    if (destination.ok !== true) return refused(observation, destination);
    observation = "publication_identity";
    const resolved = await resolveCandidatePublicationIdentity({
      mainRepo, wk, candidateState: await authenticateVersion(wk, version.version), deps,
      selection: { version: version.version, destination: projectHandoffDestination(destination.destination) }
    });
    if (resolved.ok !== true) return refused(observation, resolved);
    if (resolved.identity === undefined) return { landed: null };
    observation = "publication";
    const located = await locateWkPublication({ mainRepo, wk, identity: resolved.identity, deps });
    if (located.ok !== true) return refused(observation, located);
    const { identity } = located;
    if (identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED) {
      observation = "pull_request";
      const proposals = await observeExactPullRequests({
        forge: identity.forge, repository: identity.repository, base: identity.landing, head: identity.branch
      });
      if (proposals.ok !== true) {
        const { ok: _ok, ...cause } = proposals;
        return unobservable(observation, { cause });
      }
      if (proposals.matches.length !== 1 || proposals.matches[0].merged !== true) return { landed: null };
      observation = "closeout_chain";
      return { landed: await identity.chainAt(proposals.matches[0].head_sha) };
    }
    observation = "handoff_ref";
    const recorded = readLocalRef({ repo: mainRepo, ref: identity.handoffRef, runGit });
    if (recorded.kind === "unobservable") return unobservable(observation, { evidence: recorded.evidence });
    if (recorded.kind !== "present") return { landed: null };
    observation = "closeout_chain";
    const chain = await identity.chainAt(recorded.sha);
    if (chain === null) return { landed: null };
    observation = "landing_base";
    const landing = observeGitTransportLanding({ mainRepo, identity, chains: [chain], runGit });
    if (landing.refusal !== undefined) return refused(observation, landing.refusal);
    return { landed: landing.landed };
  } catch (error) {
    return unobservable(observation, { evidence: captureDiagnosticEvidence(error) });
  }
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
  const chainAt = identity.chainAt;
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
    const retry = observeLandedRetry({ mainRepo, wk, landed: observed.landed, binding });
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
    const located = await locateWkPublication({
      mainRepo, wk, identity: resolved.identity, synchronization: candidateState.synchronization, deps
    });
    if (located.ok !== true) return located;
    const identity = located.identity;
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

    const chainAt = identity.chainAt;
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
      const retry = observeLandedRetry({ mainRepo, wk, landed, binding });
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
          title: wkProposalTitle({ wk, title: candidateRecord.title }),
          body: wkProposalDescription({ wk, candidate: binding.candidate })
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

    if (effects.pull_request === "existing" && proposal.pullRequest.merged !== true) {
      const number = proposal.pullRequest.number;
      const undescribed = (reason, facts) => withEffects(refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE, {
        stage: "pull_request", reason, pull_request: number, published_head: authenticatedHead, ...facts
      }), effects);
      let described;
      try {
        described = await forge.readPullRequestDescription({ number });
      } catch (error) {
        return undescribed("pull_request_description_unobservable", { evidence: captureDiagnosticEvidence(error) });
      }
      const body = wkProposalDescription({ wk, candidate: binding.candidate, body: described.body });
      if (body !== described.body) {
        let updateOutcome;
        effectInFlight = "pull_request_description";
        try {
          const returned = await forge.updatePullRequestDescription({ number, body });
          updateOutcome = returned?.kind === "updated"
            ? { update_outcome: "returned", update_kind: "updated" }
            : { update_outcome: "returned", update_kind: typeof returned?.kind === "string" ? returned.kind : null,
              update_evidence: returnedOutcomeEvidence(returned) };
        } catch (error) {
          updateOutcome = { update_outcome: "threw", update_evidence: captureDiagnosticEvidence(error) };
        }
        effectInFlight = null;
        recordAnswer("pull_request_description", updateOutcome, updateOutcome.update_evidence);
        let observed;
        try {
          observed = await forge.readPullRequestDescription({ number });
        } catch (error) {
          return undescribed("pull_request_description_update_not_observed", {
            uncertain_effect: "pull_request_description", evidence: captureDiagnosticEvidence(error)
          });
        }
        if (observed.body !== body) {
          return undescribed("pull_request_description_update_not_observed", {
            uncertain_effect: "pull_request_description"
          });
        }
        mutations.pending = null;
        effects.pull_request_description = "updated";
      }
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
    const located = await locateWkPublication({ mainRepo, wk, identity: resolved.identity, deps });
    if (located.ok !== true) return located;
    const identity = located.identity;
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

async function observeSelectedPublication({ mainRepo, wk, authorityContext, selection, deps }) {
  let landing = null;
  const unavailable = (reason, extra = {}) => ({
    ...refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "selected_publication", reason, ...extra
    }), landing
  });
  try {
    const candidateState = await deps.observeHistoricalTerminalCandidatePublicationState(wk, selection.version);
    const resolved = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, selection, deps });
    if (!resolved.ok) return resolved;
    if (resolved.unauthenticatedForge !== undefined) {
      return unavailable("authenticated_forge_required_for_existing_publication", {
        probe: forgeProbeDiagnostic(resolved.unauthenticatedForge)
      });
    }
    const located = await locateWkPublication({ mainRepo, wk, identity: resolved.identity, deps });
    if (!located.ok) return located;
    const identity = located.identity;
    const { binding, guard, forge, repository, landing: base, branch, handoffRef } = identity;
    const moved = await guard();
    if (moved !== null) return moved;
    let publicationHead = null;
    let pullRequest = null;
    if (identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED) {
      const proposals = await observeExactPullRequests({ forge, repository, base, head: branch });
      if (!proposals.ok) return pullRequestObservationRefusal(proposals);

      pullRequest = proposals.matches.find((entry) => entry.number === selection.proposal) ?? null;
      if (pullRequest === null) {
        return proposals.matches.length === 1
          ? refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, {
              reason: "publication_selection_proposal_mismatch", proposal: proposals.matches[0].number
            })
          : unavailable("publication_selection_proposal_unestablished");
      }
      const observed = await forge.observeRemoteBranch({ branch });
      if (observed.kind === "unobservable") {
        return unavailable("remote_candidate_state_unprovable", { observation: branchObservationFacts(observed) });
      }
      publicationHead = observed.kind === "present" ? observed.sha : null;
      if (pullRequest.head_sha !== selection.head ||
          !(pullRequest.merged === true || (pullRequest.state === "open" && publicationHead === selection.head))) {
        return unavailable("selected_proposal_head_not_published_or_merged");
      }
      const exact = authenticateExactProposal([pullRequest], selection.head);
      if (!exact.ok) return exact;
      pullRequest = exact.pullRequest;
    } else {
      const recorded = readLocalRef({ repo: mainRepo, ref: handoffRef, runGit: deps.runGit ?? defaultRunGit });
      if (recorded.kind === "unobservable") return gitTransportFailure("handoff_ref", "handoff_ref_unobservable", recorded);
      publicationHead = recorded.kind === "present" ? recorded.sha : null;
    }
    const chain = await authenticatedChainAt({ mainRepo, wk, binding, sha: selection.head, deps });
    if (chain === null) return unavailable("selected_publication_chain_unestablished");

    const mint = identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED
      ? mintAuthenticatedHandoffResult : mintAuthenticatedGitHandoffResult;
    const handoff = mint({
      identity, authenticatedHead: chain.head, pullRequest,
      boundaryAuthorization: null, authentication: "observed_exact_publication", landingOnly: true,
      effects: { closeout_chain: "existing" }
    });
    landing = await deps.observeSelectedHandoffLanding(handoff);
    if (landing.state === "unavailable") return unavailable("selected_publication_landing_unavailable");
    let finalGuard = guard;
    if (landing.state !== "landed") {
      const mergedSelectedProposal = publicationHead === null &&
        identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED &&
        pullRequest.merged === true && pullRequest.head_sha === selection.head;
      if (publicationHead !== selection.head && !mergedSelectedProposal) {
        return unavailable("selected_publication_not_current_or_landed");
      }

      const current = await deps.observeTerminalCandidatePublicationState(wk, authorityContext);
      if (current?.binding?.candidate !== binding.candidate) return unavailable("selected_publication_not_current_or_landed");
      const generation = await authenticateForgeGenerationAuthority({ mainRepo, wk, candidateState: current });
      if (!generation.ok) return { ...refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, generation.detail), landing };
      const applicable = await resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState: current, selection, deps });
      if (!applicable.ok) return { ...applicable, landing };
      if (applicable.identity.candidateVersionDecision.version_identity !== selection.version) {
        return unavailable("selected_publication_not_current_or_landed");
      }
      const pending = applicable.identity.destination.transport === HANDOFF_TRANSPORTS.HOSTED
        ? await observeExistingPublication({ mainRepo, wk, candidateState: current, deps })
        : await observeExistingGitTransportHandoff({ mainRepo, wk, identity: identity.candidate_destination === null
            ? applicable.identity
            : { ...applicable.identity, branch: identity.branch, handoffRef: identity.handoffRef }, deps });
      if (!pending.ok) return {
        ...refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
          ...pending.detail, category: pending.category
        }), landing
      };
      if (pending.result.commit !== selection.head ||
          (pending.result.pull_request?.number ?? null) !== (selection.proposal ?? null)) {
        return unavailable("selected_publication_moved_during_observation", {
          expected_head: selection.head, observed_head: pending.result.commit
        });
      }
      finalGuard = applicable.identity.guard;
    }
    const changed = await guard() ?? await finalGuard();
    if (changed !== null) return { ...changed, landing };
    const retained = authenticatedHandoffResults.get(handoff);
    authenticatedHandoffResults.set(handoff, Object.freeze({ ...retained, landing_only: false }));
    return { ok: true, result: handoff, landing };
  } catch (error) {
    return {
      ...refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE,
        error instanceof WkCloseoutObservationError ? wkCloseoutObservationDetail(error) : {
          stage: "selected_publication", reason: "selected_publication_authentication_failed",
          evidence: captureDiagnosticEvidence(error)
        }), landing
    };
  }
}

export async function defaultWkForgeHandoff({
  mainRepo, assignedUnit, expectedVersion = null, deps = {}
} = {}) {
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

        let landedBeforeWrite = null;
        const beforeFirstWrite = async () => {
          const observed = await observeLandedWkPublication({ mainRepo, wk, deps });
          if (observed.unobservable === undefined && observed.landed === null) return;
          landedBeforeWrite = { error: new Error("the WK's publication stops this preparation"), ...observed };
          throw landedBeforeWrite.error;
        };
        try {
          candidateState = await deps.resolveTerminalCandidatePublicationState(
            wk, authorityContext, expectedVersion, { beforeFirstWrite }
          );
        } catch (error) {
          if (landedBeforeWrite !== null && error === landedBeforeWrite.error) {

            if (landedBeforeWrite.unobservable !== undefined) {
              return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
                stage: "landing", reason: "published_handoff_landing_unobservable",
                subject: { assigned_unit: wk }, ...landedBeforeWrite.unobservable
              });
            }
            return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
              stage: "landing", reason: "published_handoff_already_landed",
              landed_head: landedBeforeWrite.landed.head
            });
          }
          resolutionFailure = { error };
          throw error;
        }
        if (candidateState === null || candidateState === undefined) {
          return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
            reason: "exact_terminal_candidate_unavailable"
          });
        }

        const afterSynchronization = (outcome) =>
          outcome?.ok !== false || candidateState.synchronization == null ||
            outcome.detail?.synchronization !== undefined ? outcome
            : { ...outcome, detail: { ...outcome.detail, synchronization: candidateState.synchronization } };
        const generationAuthority = await authenticateForgeGenerationAuthority({
          mainRepo, wk, candidateState
        });
        if (generationAuthority.ok !== true) {
          return afterSynchronization(
            refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, generationAuthority.detail));
        }
        return retainGenerationBinding(
          afterSynchronization(await publishExactTerminalCandidate({ mainRepo, wk, candidateState, deps })),
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
  mainRepo, assignedUnit, authorityContext, selection, deps = {}
} = {}) {
  if (typeof mainRepo !== "string" || mainRepo.length === 0) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "main_repo_missing" });
  }
  if (typeof assignedUnit !== "string" || !WK_RECORD_RE.test(assignedUnit)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, { issue: "assigned_unit_invalid" });
  }
  if (selection !== undefined) {
    const validated = validateWkPublicationSelection(selection);
    if (!validated.ok) return validated;
    selection = validated.selection;
    let format;
    try {
      format = git(deps.runGit ?? defaultRunGit, mainRepo, ["rev-parse", "--show-object-format"]);
    } catch (error) {
      return gitTransportFailure("repository", "repository_object_format_unobservable", {
        evidence: captureDiagnosticEvidence(error)
      });
    }
    if (!oidReForObjectFormat(format).test(selection.head)) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, {
        reason: "publication_selection_object_format_mismatch", field: "selection.head",
        object_format: format
      });
    }
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
    if (selection !== undefined) {
      return observeSelectedPublication({ mainRepo, wk, authorityContext, selection, deps });
    }
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
