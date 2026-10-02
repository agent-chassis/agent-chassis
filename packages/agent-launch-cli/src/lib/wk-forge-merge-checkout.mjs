

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, copyFileSync, fsyncSync, lstatSync, openSync, readFileSync, readlinkSync,
  realpathSync, renameSync, rmSync, unlinkSync, writeSync
} from "node:fs";
import path from "node:path";

import { withWorkRecordWriteLock } from "@agent-chassis/wiki-core/src/operations/work-record-write-lock.mjs";

import {
  controlledContractGenerationPopulationPaths,
  controlledContractRetainedGenerationPaths,
  controlledContractStructuralDiffPaths
} from "./controlled-carrier-attachment-primitive.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { assessWkHandoffRefresh, authenticateWkCloseoutChain } from "./wk-forge-handoff.mjs";
import { observeAuthenticatedHandoffLanding, WK_LANDING_STATES } from "./wk-forge-landed-publication.mjs";
import {
  git,
  HANDOFF_TRANSPORTS,
  isAncestor,
  readLocalRef,
  resolveRemoteUrl
} from "./wk-handoff-destination.mjs";

export const WK_FORGE_MERGE_CHECKOUT_RESULT_SCHEMA_VERSION =
  "agent_launch.wk_forge_merge_checkout_result.v1";

export const WK_FORGE_MERGE_CHECKOUT_FAILURE_CATEGORIES = Object.freeze({
  ELIGIBILITY: "eligibility",
  IDENTITY: "identity_disagreement",
  CONTENT: "checkout_content_conflict",
  CONCURRENT: "concurrent_change",
  GIT: "git_failed",
  FAST_FORWARD: "fast_forward_refused"
});

const CATEGORIES = WK_FORGE_MERGE_CHECKOUT_FAILURE_CATEGORIES;
const ENTRY_RE = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t([\s\S]+)$/u;
const TREE_ENTRY_RE = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/u;

const TRANSPORT_ENV = Object.freeze({ GIT_TERMINAL_PROMPT: "0" });

class CheckoutRefusal extends Error {
  constructor(category, detail) {
    super(detail.reason);
    this.category = category;
    this.detail = detail;
  }
}

function refusal(category, detail) {
  return new CheckoutRefusal(category, detail);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function gitOrRefuse(runGit, repo, args, { stage, reason, env = null }) {
  try {
    return git(runGit, repo, args, env);
  } catch (error) {
    throw refusal(CATEGORIES.GIT, { stage, reason, evidence: captureDiagnosticEvidence(error) });
  }
}

function withIndexFile(indexFile) {
  return { ...process.env, GIT_INDEX_FILE: indexFile };
}

function records(output) {
  return output.split("\0").filter((record) => record.length > 0);
}

function sameEntry(left, right) {
  return left !== null && right !== null && left.mode === right.mode && left.oid === right.oid;
}

function projectEntry(entry) {
  return entry === null ? null : { mode: entry.mode, oid: entry.oid };
}

function indexEntries({ runGit, repo, indexFile, paths }) {
  const output = gitOrRefuse(runGit, repo,
    ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", ...paths],
    { stage: "index", reason: "index_unreadable", env: withIndexFile(indexFile) });
  const entries = new Map();
  for (const record of records(output)) {
    const match = ENTRY_RE.exec(record);
    if (match === null) {
      throw refusal(CATEGORIES.GIT, { stage: "index", reason: "index_entry_malformed", record });
    }
    if (match[3] !== "0") {
      throw refusal(CATEGORIES.CONTENT, { stage: "index", reason: "selected_path_unmerged", path: match[4] });
    }
    entries.set(match[4], { mode: match[1], oid: match[2] });
  }
  return entries;
}

function unrelatedIndex({ runGit, repo, indexFile, selected }) {
  const selectedSet = new Set(selected);
  return records(gitOrRefuse(runGit, repo, ["ls-files", "--stage", "-z"],
    { stage: "index", reason: "index_unreadable", env: withIndexFile(indexFile) }))
    .filter((entry) => !selectedSet.has(ENTRY_RE.exec(entry)?.[4]));
}

function treeEntries({ runGit, repo, commit, paths }) {
  const output = gitOrRefuse(runGit, repo, ["ls-tree", "-z", "--full-tree", commit, "--", ...paths],
    { stage: "tree", reason: "tree_unreadable" });
  const entries = new Map();
  for (const record of records(output)) {
    const match = TREE_ENTRY_RE.exec(record);
    if (match !== null && match[2] === "blob") entries.set(match[4], { mode: match[1], oid: match[3] });
  }
  return entries;
}

function workingState(repo, repositoryPath) {
  const absolute = path.join(repo, ...repositoryPath.split("/"));
  let stat;
  try {
    stat = lstatSync(absolute, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw refusal(CATEGORIES.ELIGIBILITY, {
      stage: "working_tree", reason: "working_path_unreadable", path: repositoryPath,
      evidence: captureDiagnosticEvidence(error)
    });
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw refusal(CATEGORIES.CONTENT, {
      stage: "working_tree", reason: "selected_path_not_a_file", path: repositoryPath
    });
  }
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
  return [
    stat.mode, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs,
    createHash("sha256").update(bytes).digest("hex")
  ].map(String).join(":");
}

function observeHead(runGit, repo) {
  const res = runGit({ repo, args: ["symbolic-ref", "-q", "HEAD"] });
  let ref;
  if (res?.ok === true) ref = String(res.stdout).trim();
  else if (res?.status === 1 && res?.error == null) ref = null;
  else {
    throw refusal(CATEGORIES.GIT, {
      stage: "checkout", reason: "checkout_head_unobservable", evidence: captureDiagnosticEvidence(res)
    });
  }
  const sha = gitOrRefuse(runGit, repo, ["rev-parse", "--verify", "HEAD^{commit}"],
    { stage: "checkout", reason: "checkout_head_unobservable" });
  return { ref, sha };
}

function hasCommit(runGit, repo, commit) {
  return runGit({ repo, args: ["cat-file", "-e", `${commit}^{commit}`] })?.ok === true;
}

function absoluteGitPath(runGit, repo, args, reason) {
  return realpathSync(path.resolve(repo, gitOrRefuse(runGit, repo, args, { stage: "checkout", reason })));
}

function bindCheckout({ runGit, mainRepo, handoff, requested }) {
  const location = requested ?? mainRepo;
  let toplevel;
  try {
    toplevel = realpathSync(path.resolve(git(runGit, location, ["rev-parse", "--show-toplevel"])));
  } catch (error) {
    throw refusal(CATEGORIES.ELIGIBILITY, {
      stage: "checkout", reason: "checkout_not_a_git_worktree", checkout: location,
      evidence: captureDiagnosticEvidence(error)
    });
  }
  if (toplevel !== realpathSync(location)) {
    throw refusal(CATEGORIES.ELIGIBILITY, {
      stage: "checkout", reason: "checkout_not_a_worktree_root", checkout: location, observed: toplevel
    });
  }
  const shared = absoluteGitPath(runGit, location, ["rev-parse", "--git-common-dir"], "checkout_storage_unobservable") ===
    absoluteGitPath(runGit, mainRepo, ["rev-parse", "--git-common-dir"], "checkout_storage_unobservable");
  if (handoff.transport === HANDOFF_TRANSPORTS.LOCAL) {
    if (!shared) {
      throw refusal(CATEGORIES.IDENTITY, {
        stage: "checkout", reason: "checkout_not_in_main_repository_storage", checkout: location
      });
    }
    return { path: toplevel, binding: location === mainRepo ? "main_repository" : "linked_worktree", remote: null };
  }
  const destinationRemote = handoff.destination.remote;
  if (shared) {
    return {
      path: toplevel,
      binding: location === mainRepo ? "main_repository" : "linked_worktree",
      remote: destinationRemote
    };
  }
  const destination = resolveRemoteUrl({ repo: mainRepo, remoteName: destinationRemote, runGit });
  if (destination.ok !== true) {
    throw refusal(CATEGORIES.IDENTITY, {
      stage: "destination", reason: destination.reason,
      ...(destination.evidence === undefined ? {} : { evidence: destination.evidence })
    });
  }
  const remotes = gitOrRefuse(runGit, toplevel, ["remote"], { stage: "checkout", reason: "checkout_remotes_unreadable" })
    .split("\n").map((line) => line.trim()).filter(Boolean)
    .filter((remote) => {
      const observed = resolveRemoteUrl({ repo: toplevel, remoteName: remote, runGit });
      return observed.ok === true && observed.url === destination.url;
    });
  if (remotes.length !== 1) {
    throw refusal(CATEGORIES.IDENTITY, {
      stage: "checkout", reason: "checkout_not_bound_to_destination", checkout: location,
      matching_remotes: remotes
    });
  }
  return { path: toplevel, binding: "destination_clone", remote: remotes[0] };
}

function ensureHandoffHead({ runGit, checkout, handoff }) {
  if (hasCommit(runGit, checkout.path, handoff.commit)) return "present";
  gitOrRefuse(runGit, checkout.path, [
    "fetch", "--no-write-fetch-head", "--refmap=", "--no-tags", "--no-recurse-submodules", "--quiet",
    checkout.remote, `refs/heads/${handoff.branch}`
  ], { stage: "destination", reason: "handoff_head_fetch_failed", env: { ...process.env, ...TRANSPORT_ENV } });
  if (!hasCommit(runGit, checkout.path, handoff.commit)) {
    throw refusal(CATEGORIES.IDENTITY, {
      stage: "destination", reason: "handoff_head_absent_from_destination", expected: handoff.commit
    });
  }
  return "fetched";
}

function withLockedIndexCopy({ runGit, repo }, work) {
  const indexFile = path.resolve(repo, gitOrRefuse(runGit, repo, ["rev-parse", "--git-path", "index"],
    { stage: "index", reason: "index_path_unresolvable" }));
  const held = { lock: `${indexFile}.lock`, fd: null };
  try {
    held.fd = openSync(held.lock, "wx", 0o666);
  } catch (error) {
    throw refusal(CATEGORIES.GIT, {
      stage: "index_lock", reason: error?.code === "EEXIST" ? "index_locked" : "index_lock_unavailable",
      evidence: captureDiagnosticEvidence(error)
    });
  }
  const temporary = `${indexFile}.agent-launch-forge-merge-${randomBytes(8).toString("hex")}`;
  try {
    try {
      copyFileSync(indexFile, temporary);
    } catch (error) {
      throw refusal(CATEGORIES.GIT, {
        stage: "index", reason: error?.code === "ENOENT" ? "index_absent" : "index_unreadable",
        evidence: captureDiagnosticEvidence(error)
      });
    }
    const { publish, value } = work({ indexFile, temporary });
    if (publish) {
      try {
        const bytes = readFileSync(temporary);
        let written = 0;
        while (written < bytes.length) written += writeSync(held.fd, bytes, written);
        fsyncSync(held.fd);
        closeSync(held.fd);
        held.fd = null;
        renameSync(held.lock, indexFile);
        held.lock = null;
      } catch (error) {
        throw refusal(CATEGORIES.GIT, {
          stage: "index_publication", reason: "index_publication_failed",
          evidence: captureDiagnosticEvidence(error)
        });
      }
    }
    return value;
  } finally {
    rmSync(temporary, { force: true });
    if (held.fd !== null) closeSync(held.fd);
    if (held.lock !== null) unlinkSync(held.lock);
  }
}

async function authenticatedRecordTransition({ runGit, mainRepo, checkout, handoff, retained }) {
  const recordPath = `wiki/work-records/${handoff.assigned_unit}.json`;
  let chain;
  try {
    chain = await authenticateWkCloseoutChain({
      mainRepo, wk: handoff.assigned_unit, candidate: retained?.binding?.candidate,
      binding: retained?.binding ?? null, head: handoff.commit, deps: { runGit }
    });
  } catch (error) {
    throw refusal(CATEGORIES.IDENTITY, {
      stage: "closeout_chain", reason: "closeout_chain_unobservable", evidence: captureDiagnosticEvidence(error)
    });
  }
  if (chain === null || chain.completion !== handoff.commit ||
      chain.closeoutRecord?.status !== "review" || chain.doneRecord?.status !== "done") return null;
  const review = treeEntries({ runGit, repo: checkout.path, commit: chain.closeout, paths: [recordPath] })
    .get(recordPath) ?? null;
  const done = treeEntries({ runGit, repo: checkout.path, commit: chain.completion, paths: [recordPath] })
    .get(recordPath) ?? null;
  return review === null || done === null ? null : { path: recordPath, review, done };
}

function absoluteWorkingPath(repo, repositoryPath) {
  return path.join(repo, ...repositoryPath.split("/"));
}

function replaceWorkingFile(absolute, bytes, mode) {
  const temporary = path.join(path.dirname(absolute),
    `.${path.basename(absolute)}.agent-launch-forge-merge-${randomBytes(8).toString("hex")}`);
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      let written = 0;
      while (written < bytes.length) written += writeSync(fd, bytes, written);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temporary, mode);
    renameSync(temporary, absolute);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function installDoneRecord({ runGit, repo, transition, expected }) {
  const absolute = absoluteWorkingPath(repo, transition.path);

  const blob = runGit({ repo, args: ["cat-file", "blob", transition.done.oid] });
  if (blob?.ok !== true || typeof blob.stdout !== "string") {
    throw refusal(CATEGORIES.GIT, {
      stage: "transition", reason: "done_record_unreadable", evidence: captureDiagnosticEvidence(blob)
    });
  }
  const bytes = Buffer.from(blob.stdout, "utf8");
  const priorBytes = readFileSync(absolute);
  const priorMode = Number(lstatSync(absolute).mode & 0o7777);
  if (workingState(repo, transition.path) !== expected) {
    throw refusal(CATEGORIES.CONCURRENT, {
      stage: "working_tree", reason: "selected_path_changed_during_preparation", path: transition.path
    });
  }
  const installed = { path: transition.path, prior: { bytes: priorBytes, mode: priorMode }, written: null };
  try {
    replaceWorkingFile(absolute, bytes, transition.done.mode === "100755" ? 0o755 : 0o644);
  } catch (error) {
    installed.written = workingState(repo, transition.path);
    throw Object.assign(refusal(CATEGORIES.GIT, {
      stage: "transition", reason: "done_record_installation_failed", evidence: captureDiagnosticEvidence(error)
    }), { installed });
  }
  installed.written = workingState(repo, transition.path);
  return installed;
}

function restoreInstalledRecord({ repo, installed }) {
  if (installed === null) return null;
  try {
    if (installed.written === null || workingState(repo, installed.path) !== installed.written) {
      return { path: installed.path, state: "not_restored", reason: "working_file_changed_after_preparation" };
    }
    const absolute = absoluteWorkingPath(repo, installed.path);
    replaceWorkingFile(absolute, installed.prior.bytes, installed.prior.mode);
    if (!readFileSync(absolute).equals(installed.prior.bytes) ||
        Number(lstatSync(absolute).mode & 0o7777) !== installed.prior.mode) {
      return { path: installed.path, state: "not_restored", reason: "working_file_restoration_unverified" };
    }
    return { path: installed.path, state: "restored" };
  } catch (error) {
    return {
      path: installed.path, state: "not_restored", reason: "working_file_restoration_failed",
      evidence: captureDiagnosticEvidence(error)
    };
  }
}

function prepareCoordinationFiles({ runGit, checkout, handoff, head, selected, transition }) {
  const repo = checkout.path;
  const owned = { installed: null };
  try {
    return stageCoordinationFiles({ runGit, repo, handoff, head, selected, transition, owned });
  } catch (error) {
    if (owned.installed === null && error?.installed === undefined) throw error;
    const workingFile = restoreInstalledRecord({ repo, installed: owned.installed ?? error.installed });
    const detail = error instanceof CheckoutRefusal
      ? { category: error.category, ...error.detail }
      : { category: CATEGORIES.GIT, stage: "preparation", reason: "preparation_failed",
        evidence: captureDiagnosticEvidence(error) };
    const { category, ...rest } = detail;
    throw refusal(category, {
      ...rest,
      restoration: { index: "unchanged", restored: [], not_restored: [], working_file: workingFile }
    });
  }
}

function stageCoordinationFiles({ runGit, repo, handoff, head, selected, transition, owned: ownership }) {
  return withLockedIndexCopy({ runGit, repo }, ({ indexFile, temporary }) => {
    const target = treeEntries({ runGit, repo, commit: handoff.commit, paths: selected });
    const atHead = treeEntries({ runGit, repo, commit: head.sha, paths: selected });
    const before = indexEntries({ runGit, repo, indexFile: temporary, paths: selected });
    const working = new Map();
    for (const repositoryPath of selected) {
      const d = target.get(repositoryPath) ?? null;
      const h = atHead.get(repositoryPath) ?? null;
      const i = before.get(repositoryPath) ?? null;
      const k = transition?.path === repositoryPath ? transition.review : null;
      if (d === null) {
        throw refusal(CATEGORIES.CONTENT, {
          stage: "handoff", reason: "selected_path_absent_from_handoff", path: repositoryPath
        });
      }
      if (transition?.path === repositoryPath && !sameEntry(transition.done, d)) {
        throw refusal(CATEGORIES.IDENTITY, {
          stage: "transition", reason: "done_record_disagrees_with_handoff", path: repositoryPath
        });
      }
      if (!(i === null ? h === null : sameEntry(i, h) || sameEntry(i, d) || sameEntry(i, k))) {
        throw refusal(CATEGORIES.CONTENT, {
          stage: "index", reason: "selected_path_independently_staged", path: repositoryPath,
          expected: projectEntry(d), head: projectEntry(h), observed: projectEntry(i)
        });
      }
      const state = workingState(repo, repositoryPath);
      if (state !== null) working.set(repositoryPath, state);
    }
    const present = selected.filter((repositoryPath) => working.has(repositoryPath));
    if (present.length > 0) {
      gitOrRefuse(runGit, repo, ["update-index", "--add", "--", ...present],
        { stage: "index", reason: "selected_path_staging_failed", env: withIndexFile(temporary) });
    }
    const staged = indexEntries({ runGit, repo, indexFile: temporary, paths: selected });
    const owned = [];
    const alreadyStaged = [];
    const unaffected = [];
    let install = false;
    for (const repositoryPath of selected) {
      const d = target.get(repositoryPath);
      const h = atHead.get(repositoryPath) ?? null;
      const i = before.get(repositoryPath) ?? null;
      if (!working.has(repositoryPath)) {
        if (sameEntry(i, transition?.path === repositoryPath ? transition.review : null)) {
          throw refusal(CATEGORIES.CONTENT, {
            stage: "working_tree", reason: "selected_path_content_differs", path: repositoryPath,
            expected: projectEntry(d), observed: null
          });
        }
        unaffected.push({ path: repositoryPath, reason: "absent_from_working_tree" });
        continue;
      }
      const s = staged.get(repositoryPath) ?? null;
      if (transition?.path === repositoryPath && sameEntry(s, transition.review)) {

        install = true;
        if (sameEntry(i, d)) alreadyStaged.push(repositoryPath);
        else owned.push({ path: repositoryPath, prior: i, staged: d });
      } else if (sameEntry(s, d)) {
        if (sameEntry(i, d)) alreadyStaged.push(repositoryPath);
        else owned.push({ path: repositoryPath, prior: i, staged: d });
      } else if (sameEntry(s, h) && sameEntry(i, h)) {

        unaffected.push({ path: repositoryPath, reason: "clean_at_head" });
      } else {
        throw refusal(CATEGORIES.CONTENT, {
          stage: "working_tree", reason: "selected_path_content_differs", path: repositoryPath,
          expected: projectEntry(d), observed: projectEntry(s)
        });
      }
    }
    const original = unrelatedIndex({ runGit, repo, indexFile, selected });
    const prepared = unrelatedIndex({ runGit, repo, indexFile: temporary, selected });
    if (original.length !== prepared.length || original.some((entry, index) => entry !== prepared[index])) {
      throw refusal(CATEGORIES.GIT, { stage: "index", reason: "index_preparation_escaped_selection" });
    }
    for (const [repositoryPath, state] of working) {
      if (workingState(repo, repositoryPath) !== state) {
        throw refusal(CATEGORIES.CONCURRENT, {
          stage: "working_tree", reason: "selected_path_changed_during_preparation", path: repositoryPath
        });
      }
    }
    const now = observeHead(runGit, repo);
    if (now.ref !== head.ref || now.sha !== head.sha) {
      throw refusal(CATEGORIES.CONCURRENT, { stage: "checkout", reason: "checkout_changed_during_preparation" });
    }
    if (install) {

      ownership.installed = installDoneRecord({
        runGit, repo, transition, expected: working.get(transition.path)
      });
      gitOrRefuse(runGit, repo, ["update-index", "--add", "--", transition.path],
        { stage: "index", reason: "selected_path_staging_failed", env: withIndexFile(temporary) });
      const installed = indexEntries({ runGit, repo, indexFile: temporary, paths: [transition.path] });
      if (!sameEntry(installed.get(transition.path) ?? null, transition.done)) {
        throw refusal(CATEGORIES.GIT, {
          stage: "transition", reason: "done_record_installation_unverified", path: transition.path
        });
      }
    }
    return {
      publish: owned.length > 0,
      value: { owned, alreadyStaged, unaffected, installed: ownership.installed }
    };
  });
}

function restoreOwnedStaging({ runGit, checkout, owned }) {
  if (owned.length === 0) return { index: "unchanged", restored: [], not_restored: [] };
  const paths = owned.map((entry) => entry.path);
  try {
    return withLockedIndexCopy({ runGit, repo: checkout.path }, ({ temporary }) => {
      const current = indexEntries({ runGit, repo: checkout.path, indexFile: temporary, paths });
      const restorable = owned.filter((entry) => sameEntry(current.get(entry.path) ?? null, entry.staged));
      const notRestored = owned.filter((entry) => !restorable.includes(entry))
        .map((entry) => ({ path: entry.path, reason: "index_entry_changed_after_preparation" }));
      const removals = restorable.filter((entry) => entry.prior === null).map((entry) => entry.path);
      const reverts = restorable.filter((entry) => entry.prior !== null)
        .flatMap((entry) => ["--cacheinfo", `${entry.prior.mode},${entry.prior.oid},${entry.path}`]);
      const env = withIndexFile(temporary);
      if (removals.length > 0) {
        gitOrRefuse(runGit, checkout.path, ["update-index", "--force-remove", "--", ...removals],
          { stage: "restoration", reason: "owned_staging_restoration_failed", env });
      }
      if (reverts.length > 0) {
        gitOrRefuse(runGit, checkout.path, ["update-index", ...reverts],
          { stage: "restoration", reason: "owned_staging_restoration_failed", env });
      }
      const after = indexEntries({ runGit, repo: checkout.path, indexFile: temporary, paths });
      for (const entry of restorable) {
        const observed = after.get(entry.path) ?? null;
        if (entry.prior === null ? observed !== null : !sameEntry(observed, entry.prior)) {
          throw refusal(CATEGORIES.GIT, {
            stage: "restoration", reason: "owned_staging_restoration_unverified", path: entry.path
          });
        }
      }
      return {
        publish: restorable.length > 0,
        value: {
          index: restorable.length === 0 ? "prepared_entries_retained" :
            notRestored.length === 0 ? "restored" : "partially_restored",
          restored: restorable.map((entry) => entry.path),
          not_restored: notRestored
        }
      };
    });
  } catch (error) {
    return {
      index: "prepared_entries_retained",
      restored: [],
      not_restored: paths.map((entry) => ({ path: entry, reason: "restoration_failed" })),
      cause: error instanceof CheckoutRefusal
        ? { category: error.category, ...error.detail }
        : { reason: "restoration_failed", evidence: captureDiagnosticEvidence(error) }
    };
  }
}

function preparationProjection(selected, prepared) {
  return {
    selected_paths: selected,
    newly_staged: prepared.owned.map((entry) => entry.path),
    already_staged: prepared.alreadyStaged,
    unaffected: prepared.unaffected,
    record_transition: prepared.installed === null ? null : { path: prepared.installed.path, from: "review", to: "done" }
  };
}

function landingProjection(observation) {
  return {
    state: observation.state,
    observed_base: observation.observed_base,
    landed_publication: observation.landed_publication,
    cause: observation.cause
  };
}

function refused(category, detail, { nextCalls = null, observedFacts = null } = {}) {
  return {
    ok: false, category, detail: deepFreeze(detail),
    ...(observedFacts === null ? {} : { observed_facts: observedFacts }),
    ...(nextCalls === null ? {} : { next_calls: nextCalls })
  };
}

async function refreshGuidance({ mainRepo, handoff, target, error, runGit }) {
  if (error.detail.reason !== "selected_path_content_differs" || target?.binding !== "main_repository" ||
      error.detail.path !== `wiki/work-records/${handoff.assigned_unit}.json` || error.detail.observed === null) {
    return null;
  }
  const { next_calls: nextCalls = null, observed_facts: observedFacts = null, ...assessment } =
    await assessWkHandoffRefresh({ mainRepo, handoff, deps: { runGit } });
  return { assessment, nextCalls, observedFacts };
}

export async function mergeWkHandoffIntoCheckout({ mainRepo, handoff, retained, checkout = null, runGit }) {
  let effects = { index: "unchanged", working_tree: "unchanged", checkout_branch: "unchanged", push: "none" };
  let preparation = null;
  let lockRelease = null;
  let target = null;
  try {
    target = bindCheckout({ runGit, mainRepo, handoff, requested: checkout });
    const head = observeHead(runGit, target.path);
    const baseRef = `refs/heads/${handoff.base_branch}`;
    if (head.ref !== baseRef) {
      throw refusal(CATEGORIES.ELIGIBILITY, {
        stage: "checkout", reason: "checkout_not_on_base_branch", checkout: target.path,
        expected: baseRef, observed: head.ref
      });
    }
    const handoffRef = readLocalRef({ repo: mainRepo, ref: handoff.handoff_ref, runGit });
    if (handoffRef.kind !== "present" || handoffRef.sha !== handoff.commit) {
      throw refusal(CATEGORIES.CONCURRENT, {
        stage: "handoff_ref", reason: "handoff_ref_moved", expected: handoff.commit,
        observed: handoffRef.sha ?? null
      });
    }
    const objects = target.binding === "destination_clone"
      ? ensureHandoffHead({ runGit, checkout: target, handoff }) : "present";
    let fastForward = "already_contained";
    let headAfter = head.sha;
    let contained;
    try {
      contained = isAncestor({ repo: target.path, ancestor: handoff.commit, descendant: head.sha, runGit });
    } catch (error) {
      throw refusal(CATEGORIES.GIT, {
        stage: "ancestry", reason: "handoff_ancestry_unobservable", evidence: captureDiagnosticEvidence(error)
      });
    }
    if (!contained) {
      let selected;
      try {
        const binding = retained.generation_binding;

        const owned = new Set([
          ...controlledContractGenerationPopulationPaths(binding),
          ...controlledContractRetainedGenerationPaths({
            binding, since: handoff.parent, landing: handoff.commit
          })
        ]);
        selected = controlledContractStructuralDiffPaths({
          binding, before: head.sha, after: handoff.commit,
          gitDir: absoluteGitPath(runGit, target.path, ["rev-parse", "--absolute-git-dir"], "checkout_storage_unobservable")
        }).filter((repositoryPath) => owned.has(repositoryPath)).sort();
      } catch (error) {
        if (error instanceof CheckoutRefusal) throw error;
        throw refusal(CATEGORIES.IDENTITY, {
          stage: "population", reason: typeof error?.code === "string" ? error.code : "population_unavailable",
          evidence: captureDiagnosticEvidence(error)
        });
      }
      const transition = selected.includes(`wiki/work-records/${handoff.assigned_unit}.json`)
        ? await authenticatedRecordTransition({ runGit, mainRepo, checkout: target, handoff, retained })
        : null;
      const land = () => {
        const prepared = selected.length === 0
          ? { owned: [], alreadyStaged: [], unaffected: [], installed: null }
          : prepareCoordinationFiles({ runGit, checkout: target, handoff, head, selected, transition });
        const merged = runGit({ repo: target.path, args: ["merge", "--ff-only", handoff.commit] });
        const restoration = merged?.ok === true ? null : {
          ...restoreOwnedStaging({ runGit, checkout: target, owned: prepared.owned }),
          working_file: restoreInstalledRecord({ repo: target.path, installed: prepared.installed })
        };
        return { prepared, merged, restoration };
      };
      let landing;
      if (transition === null) {
        landing = land();
      } else {

        const locked = await withWorkRecordWriteLock(target.path, land, { settle: true });
        if (locked.acquisition_error !== undefined) {
          throw refusal(CATEGORIES.CONCURRENT, {
            stage: "work_record_write_lock",
            reason: typeof locked.acquisition_error?.code === "string"
              ? locked.acquisition_error.code : "work_record_write_lock_unavailable",
            evidence: captureDiagnosticEvidence(locked.acquisition_error)
          });
        }
        if (locked.callback_error !== null) throw locked.callback_error;
        landing = locked.value;
        if (locked.release_error !== null) lockRelease = captureDiagnosticEvidence(locked.release_error);
      }
      const { prepared, merged, restoration } = landing;
      preparation = preparationProjection(selected, prepared);
      if (prepared.owned.length > 0) effects = { ...effects, index: "prepared" };
      if (prepared.installed !== null) effects = { ...effects, working_tree: "record_transitioned" };
      if (merged?.ok !== true) {
        return refused(CATEGORIES.FAST_FORWARD, {
          stage: "fast_forward",
          reason: "fast_forward_refused",
          checkout: target.path,
          head: head.sha,
          handoff_head: handoff.commit,
          evidence: captureDiagnosticEvidence(merged),
          preparation,
          restoration,
          ...(lockRelease === null ? {} : { work_record_write_lock_release_failure: lockRelease }),
          effects: {
            ...effects,
            index: restoration.index === "unchanged" ? "unchanged" : restoration.index,
            working_tree: restoration.working_file === null ? "unchanged"
              : restoration.working_file.state === "restored" ? "restored" : "record_transition_retained"
          }
        });
      }

      fastForward = "completed";
      effects = { ...effects, checkout_branch: "fast_forwarded" };
      headAfter = observeHead(runGit, target.path).sha;
    }
    const observation = await observeAuthenticatedHandoffLanding({ mainRepo, handoff, deps: { runGit } });
    const landed = observation.state === WK_LANDING_STATES.LANDED;
    const result = deepFreeze({
      schema_version: WK_FORGE_MERGE_CHECKOUT_RESULT_SCHEMA_VERSION,
      assigned_unit: handoff.assigned_unit,
      transport: handoff.transport,
      destination: handoff.destination,
      terminal_candidate: handoff.terminal_candidate,
      completion: handoff.commit,
      base_branch: handoff.base_branch,
      checkout: {
        path: target.path, binding: target.binding, ref: head.ref,
        head_before: head.sha, head_after: headAfter, handoff_objects: objects
      },
      local_fast_forward: fastForward,
      preparation,
      landing: landingProjection(observation),
      ...(handoff.transport === HANDOFF_TRANSPORTS.GIT
        ? { remote_landing: landed ? "landed" : observation.state === WK_LANDING_STATES.AWAITING_HUMAN_LANDING
          ? "pending" : observation.state }
        : {}),
      landed_publication: landed ? observation.landed_publication : null,
      ...(lockRelease === null ? {} : { work_record_write_lock_release_failure: lockRelease }),
      effects
    });
    if (handoff.transport === HANDOFF_TRANSPORTS.LOCAL && !landed) {
      return refused(CATEGORIES.IDENTITY, {
        stage: "landing", reason: "local_landing_not_observed", result, effects
      });
    }
    return { ok: true, result };
  } catch (error) {
    if (error instanceof CheckoutRefusal) {
      const workingFile = error.detail.restoration?.working_file;
      const guidance = await refreshGuidance({ mainRepo, handoff, target, error, runGit });
      return refused(error.category, {
        ...error.detail,
        ...(preparation === null ? {} : { preparation }),
        ...(guidance === null ? {} : { handoff_refresh: guidance.assessment }),
        effects: workingFile === undefined || workingFile === null ? effects : {
          ...effects, working_tree: workingFile.state === "restored" ? "restored" : "record_transition_retained"
        }
      }, { nextCalls: guidance?.nextCalls ?? null, observedFacts: guidance?.observedFacts ?? null });
    }
    return refused(CATEGORIES.GIT, {
      stage: "checkout_merge", reason: "checkout_merge_failed", evidence: captureDiagnosticEvidence(error), effects
    });
  }
}
