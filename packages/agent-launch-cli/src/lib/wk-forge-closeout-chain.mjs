

import { createHash } from "node:crypto";
import {
  closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { computeWorkRecordSourceDigest } from "../../../wiki-core/src/lib/work-record-schema.mjs";
import { projectWorkRecordFreshness } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { WK_FORGE_HANDOFF_FAILURE_CATEGORIES } from "./trusted-operation-contracts.mjs";
import { authenticateWkCloseoutProjection } from "./wk-forge-handoff-recovery.mjs";
import { authenticateCanonicalIntegratedDeliveryTransition } from
  "./backend-integrated-scope-authority.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { LITERAL_INCLUSION_STATES, observeLiteralInclusionAboveFork } from
  "./slice-integration-authorization.mjs";
import { git } from "./wk-handoff-destination.mjs";
import { withWorkRecordWriteLock } from "@agent-chassis/wiki-core/src/operations/work-record-write-lock.mjs";
import { defaultRunGit } from "./wk-forge-command.mjs";
import {
  OBJECT_ID_RE,
  WK_RECORD_RE,
  canonicalJson,
  isPlainObject,
  refuse
} from "./wk-forge-handoff-refusal.mjs";

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
  if (lines.length === 0) return true;
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

function authenticateCloseoutIntegratedDeliveries({ mainRepo, wk, binding, candidateRecord, closeoutRecord }) {
  const held = new Map((Array.isArray(candidateRecord?.slices) ? candidateRecord.slices : [])
    .filter(isPlainObject).map((slice) => [slice.id, slice]));
  const claimed = (Array.isArray(closeoutRecord?.slices) ? closeoutRecord.slices : [])
    .filter((after) => isPlainObject(after) && typeof after.id === "string" &&
      typeof after.integrated_delivery_sha === "string" &&
      after.integrated_delivery_sha !== (held.get(after.id)?.integrated_delivery_sha ?? null))
    .map((after) => ({ sliceId: after.id, observed: after.integrated_delivery_sha, added: !held.has(after.id) }));
  const expectations = [];
  const failures = [];
  for (const claim of claimed) {
    const { expectation, failure } = authenticateOneIntegratedDelivery({
      mainRepo, wk, binding, candidateRecord, ...claim
    });
    if (expectation !== null) expectations.push(expectation);
    if (failure !== null) failures.push(failure);
  }
  return { expectations, failures };
}

function authenticateOneIntegratedDelivery({ mainRepo, wk, binding, candidateRecord, sliceId, observed, added }) {
  const facts = { slice_id: sliceId, observed_integrated_delivery_sha: observed, selected_w: binding?.wk_tip ?? null };
  let proof;
  try {
    proof = authenticateCanonicalIntegratedDeliveryTransition(mainRepo, `${wk}#${sliceId}`, {
      historicalParentContract: JSON.stringify(candidateRecord),
      unitAddedAfterHistory: added
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
    const included = (tipSha, targetSha) => observeLiteralInclusionAboveFork({
      runGit: defaultRunGit, mainRepo, tipSha, forkSha: null, targetSha
    }).state;
    const deliveryInSelectedW = included(binding?.wk_tip, proof.integrated_delivery_sha);
    const selectedWInAuthenticatedW = included(proof.current_w, binding?.wk_tip);
    if (deliveryInSelectedW !== LITERAL_INCLUSION_STATES.INCLUDED ||
        selectedWInAuthenticatedW !== LITERAL_INCLUSION_STATES.INCLUDED) {
      return {
        expectation: null,
        failure: {
          ...facts,
          reason: "integrated_delivery_not_bound_to_selected_w",
          authenticated_w: proof.current_w,
          delivery_in_selected_w: deliveryInSelectedW,
          selected_w_in_authenticated_w: selectedWInAuthenticatedW
        }
      };
    }
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
  const deliveries = authenticateCloseoutIntegratedDeliveries({
    mainRepo, wk, binding, candidateRecord, closeoutRecord
  });
  const projection = authenticateWkCloseoutProjection({
    candidateRecord, liveRecord: closeoutRecord, integratedDeliveries: deliveries.expectations, publishedRecord
  });

  const deliveryFailure = deliveries.failures.find((failure) => failure.slice_id === projection.slice_id) ??
    deliveries.failures[0] ?? null;
  return { projection, deliveryFailure };
}

export function readLiveWkRecord(mainRepo, wk) {
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
  route: "workspace_read_wiki",
  information: "The current authored WK and its authoring selections, including how to record " +
    "post-run results and limitations without changing candidate-bound acceptance.",
  responsible_actor: "coordinator",
  prerequisite: "the live WK record's acceptance.validation equals the declaration the terminal " +
    "candidate authenticated (acceptance_validation_drift.candidate_value)",
  retry_condition: "re-issue workspace_publish_work for the same subject after the live " +
    "acceptance.validation equals acceptance_validation_drift.candidate_value",
  explanation: "If the change was intended to record results or limitations: preserve that text in a " +
    "new entry through save_record with the revision returned by workspace_read_wiki, then " +
    "replace acceptance.validation with acceptance_validation_drift.candidate_value through " +
    "save_record using the revision that entry write returned, then retry. A stale " +
    "freshness refuses, so an intervening edit is never overwritten. If the change altered a " +
    "requirement, this candidate cannot be published: an entry records evidence only, satisfies no " +
    "unmet requirement and does not cure this drift. Reading this guidance changes nothing."
});

export function acceptanceValidationDriftProposal(unit) {
  return Object.freeze({ ...ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE,
    args: Object.freeze({ subject: unit }) });
}

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

      observed_source_digest: projectWorkRecordFreshness(computeWorkRecordSourceDigest(liveRecord))
    }),
    recovery: acceptanceValidationDriftProposal(wk)
  };
}

function comparedDrift({ wk, binding, liveRecord, projection }) {
  const { differences } = projection;
  if (!Array.isArray(differences)) return {};
  const slice = projection.reason === "unrelated_slice_drift";
  return {
    [slice ? "slice_drift" : "sections_drift"]: Object.freeze({
      unit: slice ? `${wk}#${projection.slice_id}` : wk,
      candidate: binding?.candidate ?? null,
      differences,
      observed_source_digest: projectWorkRecordFreshness(computeWorkRecordSourceDigest(liveRecord))
    })
  };
}

export function readAuthenticatedLiveCloseout({
  mainRepo, wk, candidateRecord, binding = null, publishedRecord = null
} = {}) {
  const live = readLiveWkRecord(mainRepo, wk);
  if (live.ok !== true) return live;

  const { projection, deliveryFailure } = authenticateCloseoutRecord({
    mainRepo, wk, binding, candidateRecord, closeoutRecord: live.record, publishedRecord
  });
  if (projection.ok !== true) {

    const { ok: _ok, differences: _differences, ...projectionCause } = projection;
    return {
      ok: false,
      reason: "local_WK_not_authenticated_against_candidate",
      projection: projectionCause,
      ...comparedDrift({ wk, binding, liveRecord: live.record, projection }),
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

export async function commitWkCloseoutChain({ mainRepo, wk, candidate, binding, live, deps }) {
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

export function closeoutPreparationRefusal(prepared) {
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

export async function authenticatedChainAt({ mainRepo, wk, binding, sha, deps }) {
  const chain = await authenticateWkCloseoutChain({
    mainRepo, wk, candidate: binding.candidate, binding, head: sha, deps
  });
  return chain === null || chain.completion !== sha ? null : chain;
}

export function succeedsPublishedChain({ mainRepo, wk, identity, prior, next }) {
  const { projection } = authenticateCloseoutRecord({
    mainRepo, wk, binding: identity.binding, candidateRecord: identity.candidateRecord,
    closeoutRecord: next.closeoutRecord, publishedRecord: prior.closeoutRecord
  });
  return projection.ok === true;
}

export function livePublishedUnchanged(live, chain) {
  const digest = computeWorkRecordSourceDigest(live.record);
  return [chain.closeoutRecord, chain.doneRecord].some((record) =>
    record !== null && computeWorkRecordSourceDigest(record) === digest);
}

export function classifyLiveAgainstPublication({ mainRepo, wk, binding, candidateRecord, published }) {
  const observed = readLiveWkRecord(mainRepo, wk);
  if (observed.ok === true && livePublishedUnchanged(observed, published)) {
    return { kind: "unchanged", live: observed };
  }
  const live = readAuthenticatedLiveCloseout({
    mainRepo, wk, candidateRecord, binding, publishedRecord: published.closeoutRecord
  });
  return live.ok === true ? { kind: "refreshable", live } : { kind: "refused", cause: live };
}

export async function underCapturedLiveRecord({ mainRepo, wk, live, effect }) {
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
