import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WK_FORGE_MERGE_FAILURE_CATEGORIES, defaultRunGit, defaultWkForgeMerge } from
  "../packages/agent-launch-cli/src/lib/wk-forge-merge.mjs";
import { TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3 } from
  "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { canonicalizeWorkRecordJson, projectSliceReviewReceiptContracts } from "../packages/wiki-core/src/index.mjs";

const repository = { host: "github.com", owner: "agent-chassis", name: "agent-chassis" };
const file = "wiki/work-records/WK-1788.json";
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const commit = (repo, message) => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", message); return git(repo, "rev-parse", "HEAD"); };

function fixture(t, { dependencyRef = "WK-1788#SLICE-018" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk-forge-merge-"));
  const repo = path.join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "remote", "add", "origin", "https://github.com/agent-chassis/agent-chassis.git");
  const dependency = { id: "SLICE-018", title: "implementation", work_kind: "implementation", status: "todo", priority: "high", owner: "unassigned", updated: "2026-07-29", depends_on: [], read_scope: [], repo_paths: [], write_scope: [], acceptance: { criteria: [], validation: [] }, sections: {} };
  const slice = { id: "SLICE-009", title: "review", work_kind: "review", status: "todo", priority: "high", owner: "unassigned", depends_on: [dependencyRef], read_scope: [], repo_paths: [], write_scope: [], acceptance: { criteria: [], validation: [] }, review_purpose: "terminal_whole_wk" };
  const candidateRecord = { schema_version: "work-record.v1", id: "WK-1788", repo: "agent-chassis/agent-chassis", title: "merge", record_kind: "work_item", work_kind: "implementation", initiative: "IN-0030", status: "todo", priority: "medium", owner: "unassigned", created: "2026-07-28", updated: "2026-07-29", read_scope: [], repo_paths: [], write_scope: [], depends_on: [], blocks: [], related: [], children: [], acceptance: { criteria: [], validation: [] }, sections: {}, slices: [dependency, slice] };
  const localRecord = { ...candidateRecord, status: "review", slices: [{ ...dependency, status: "done", updated: "2026-07-30", sections: { closure: { summary: "closed", validation: [], follow_ups: [] } } }, { ...slice, status: "review" }] };
  mkdirSync(path.join(repo, "wiki/work-records"), { recursive: true }); writeFileSync(path.join(repo, file), `${JSON.stringify(candidateRecord)}\n`);
  const candidate = commit(repo, "candidate"); writeFileSync(path.join(repo, file), `${JSON.stringify(localRecord, null, 2)}\n`);
  return { repo, candidate, localRecord, candidateRecord };
}

function forge(state, { failMerge = false } = {}) {
  const branch = `handoff/wk/IN-0030/WK-1788/${state.candidate}`;
  const pr = { number: 7, state: "open", merged: false, base_ref: "main", head_ref: branch, head_sha: state.candidate, repository };
  const calls = { cas: 0, merge: 0 };
  return { repository, calls, pr, probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: () => ({ kind: "present", sha: state.head ?? state.candidate }),
    observePullRequest: async () => ({ ...pr, head_sha: state.head ?? state.candidate }),
    compareAndSwapBranch: ({ expected, next }) => { calls.cas++; if (expected !== (state.head ?? state.candidate)) return { ok: false }; state.head = next; pr.head_sha = next; return { ok: true }; },
    mergePullRequest: async ({ expectedHead }) => { calls.merge++; if (failMerge) return { ok: false }; assert.equal(expectedHead, state.head); pr.merged = true; pr.state = "closed"; return { ok: true, merged: true }; },
    readMergedWk: async () => `${JSON.stringify({ ...state.localRecord, status: "done" }, null, 2)}\n` };
}

function deps(state, fake, candidateState = {}) {
  return { forge: fake, allowCompatibilityValidator: true, resolveTerminalCandidatePublicationState: async () => ({
    binding: { canonical_wk_id: "WK-1788", candidate: state.candidate },
    branch: `handoff/wk/IN-0030/WK-1788/${state.candidate}`,
    ...candidateState
  }), verifyTerminalCandidateBinding: () => true
  };
}

test("forge-merge accepts only a canonical WK selector", async () => {
  const result = await defaultWkForgeMerge({ mainRepo: "/repo", assignedUnit: "not-a-wk" });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.REQUEST_INVALID);
});

test("appends exact WK-only closeout commits and reconciles", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).status, "done");
  assert.equal(git(state.repo, "show", `${state.candidate}:${file}`), JSON.stringify(state.candidateRecord));
  assert.equal(git(state.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", result.result.candidate, result.result.review), file);
  assert.equal(git(state.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", result.result.review, result.result.completion), file);
  assert.deepEqual(git(state.repo, "rev-list", "--parents", "-n", "1", result.result.review).split(/\s+/u), [result.result.review, state.candidate]);
  assert.deepEqual(git(state.repo, "rev-list", "--parents", "-n", "1", result.result.completion).split(/\s+/u), [result.result.completion, result.result.review]);
  assert.equal(git(state.repo, "rev-parse", "HEAD"), state.candidate);
});

test("reconciles to a non-conflicting same-WK edit already present on merged main", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const mergedMainRecord = { ...state.localRecord, status: "done", title: "merged-main title" };
  const mergedMainBytes = `${JSON.stringify(mergedMainRecord, null, 2)}\n`;
  let readArgs = null;
  fake.readMergedWk = async (args) => { readArgs = args; return mergedMainBytes; };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(readArgs, { branch: "main", wk: "WK-1788" });
  assert.equal(readFileSync(path.join(state.repo, file), "utf8"), mergedMainBytes);
});

test("reconciles to the unchanged merged-main WK blob", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const mergedMainBytes = `${JSON.stringify({ ...state.localRecord, status: "done" }, null, 2)}\n`;
  fake.readMergedWk = async () => mergedMainBytes;
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readFileSync(path.join(state.repo, file), "utf8"), mergedMainBytes);
});

test("refuses an incomplete local terminal review before touching the forge", async (t) => {
  const state = fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify(state.candidateRecord));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.cas, 0);
});

test("refuses unauthenticated forge state before creating closeout commits", async (t) => {
  const state = fixture(t); const fake = forge(state); fake.probe = () => ({ state: "unauthenticated" });
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("refuses a closed unmerged pull request as a remote conflict", async (t) => {
  const state = fixture(t); const fake = forge(state); fake.pr.state = "closed";
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("refuses review purpose on a non-review slice", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const invalid = { ...state.localRecord, slices: [{ ...state.localRecord.slices[0], work_kind: "implementation" }] };
  writeFileSync(path.join(state.repo, file), JSON.stringify(invalid));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.cas, 0);
});

test("refuses a local review projection that is not authenticated to C", async (t) => {
  const state = fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, owner: "untrusted" }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0);
});

test("returns reconciliation partial success when the local WK moves after merge", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const originalMerge = fake.mergePullRequest;
  fake.mergePullRequest = async (args) => { const result = await originalMerge(args); writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, owner: "moved" })); return result; };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION);
  assert.equal(result.partial, true);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).owner, "moved");
});

test("preserves unrelated dirty paths and never moves the local main ref", async (t) => {
  const state = fixture(t); const fake = forge(state); const unrelated = path.join(state.repo, "unrelated.txt");
  writeFileSync(unrelated, "keep this dirty path\n");
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readFileSync(unrelated, "utf8"), "keep this dirty path\n");
  assert.equal(git(state.repo, "rev-parse", "HEAD"), state.candidate);
});

test("does not use reset, clean, stash, rebase, merge, or force-update git operations", async (t) => {
  const state = fixture(t); const fake = forge(state); const calls = [];
  const runGit = (input) => { calls.push(input.args); return defaultRunGit(input); };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: { ...deps(state, fake), runGit } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const commandText = calls.map((args) => args.join(" ")).join("\n");
  assert.doesNotMatch(commandText, /(?:^| )(?:reset|clean|stash|rebase|merge)(?: |$)/u);
  assert.doesNotMatch(commandText, /(?:^| )--force(?:=| |$)/u);
});

test("merge failure leaves an exact completion head for retry without another CAS", async (t) => {
  const state = fixture(t); const fake = forge(state, { failMerge: true }); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE); assert.equal(fake.calls.cas, 1);
  fake.mergePullRequest = async ({ expectedHead }) => { fake.calls.merge++; assert.equal(expectedHead, state.head); fake.pr.merged = true; fake.pr.state = "closed"; return { ok: true, merged: true }; };
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.ok, true, JSON.stringify(second)); assert.equal(fake.calls.cas, 1);
});

test("does not merge an open PR when the local WK was already marked done", async (t) => {
  const state = fixture(t); const fake = forge(state, { failMerge: true }); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, status: "done" }));
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.merge, 1);
});

test("refuses an unknown pull request lifecycle state", async (t) => {
  const state = fixture(t); const fake = forge(state); fake.pr.state = "pending";
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("refuses an invalid work-record status vocabulary", async (t) => {
  const state = fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, status: "finished" }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.cas, 0);
});

test("does not promote the compatibility validator to production authority", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: {
    forge: fake,
    resolveTerminalCandidatePublicationState: async () => ({
      binding: { canonical_wk_id: "WK-1788", candidate: state.candidate },
      branch: `handoff/wk/IN-0030/WK-1788/${state.candidate}`
    }),
    verifyTerminalCandidateBinding: () => true
  } });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_review_complete");
  assert.equal(fake.calls.cas, 0);
});

test("refuses a moved proposed change head without creating closeout commits", async (t) => {
  const state = fixture(t); const fake = forge(state);
  state.head = "a".repeat(40);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
  assert.equal(git(state.repo, "rev-parse", "HEAD"), state.candidate);
});

test("refuses a candidate bound to a different canonical repository", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: {
    ...deps(state, fake),
    resolveTerminalCandidatePublicationState: async () => ({
      binding: { canonical_wk_id: "WK-1788", candidate: state.candidate, main_repo: "/another/repository" },
      branch: `handoff/wk/IN-0030/WK-1788/${state.candidate}`
    })
  } });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(result.detail.reason, "terminal_candidate_repository_disagrees");
  assert.equal(fake.calls.cas, 0);
});

test("refuses a failed branch compare-and-swap before attempting forge merge", async (t) => {
  const state = fixture(t); const fake = forge(state);
  fake.compareAndSwapBranch = () => { fake.calls.cas++; return { ok: false }; };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.CAS);
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 0);
});

test("retry refuses to overwrite a local WK changed after partial success", async (t) => {
  const state = fixture(t); const fake = forge(state, { failMerge: true }); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, owner: "changed-during-retry" }));
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION);
  assert.equal(second.partial, true);
  assert.equal(fake.calls.cas, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).owner, "changed-during-retry");
});

test("refuses an unsafe local WK path before touching the forge", async (t) => {
  const state = fixture(t); const fake = forge(state);
  rmSync(path.join(state.repo, file));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("recognizes an already-merged exact chain when the handoff branch was deleted", async (t) => {
  const state = fixture(t); const fake = forge(state, { failMerge: true }); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  fake.pr.merged = true; fake.pr.state = "closed";
  fake.observeRemoteBranch = () => ({ kind: "unprovable" });
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(fake.calls.cas, 1);
  assert.equal(fake.calls.merge, 1);
});

test("accepts an exact already-reconciled local completion without rewriting it", async (t) => {
  const state = fixture(t); const fake = forge(state); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: {
    ...shared, forge: forge(state, { failMerge: true })
  } });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  const completion = state.head;

  const doneRecord = { ...state.localRecord, status: "done" };
  writeFileSync(path.join(state.repo, file), `${JSON.stringify(doneRecord, null, 2)}\n`);
  fake.pr.head_sha = completion; fake.pr.state = "closed"; fake.pr.merged = true;
  fake.observeRemoteBranch = () => ({ kind: "present", sha: completion });
  fake.readMergedWk = async () => `${JSON.stringify(doneRecord, null, 2)}\n`;
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.result.already_reconciled, true);
  assert.equal(readFileSync(path.join(state.repo, file), "utf8"), `${JSON.stringify(doneRecord, null, 2)}\n`);
});

test("authenticates an already-merged exact head before refusing changed local completion state", async (t) => {
  const state = fixture(t); const fake = forge(state, { failMerge: true }); const shared = deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  const completion = state.head;
  fake.pr.head_sha = completion; fake.pr.state = "closed"; fake.pr.merged = true;
  fake.observeRemoteBranch = () => ({ kind: "present", sha: completion });
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, status: "done", owner: "changed-after-merge" }));
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION);
  assert.equal(second.partial, true);
  assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).owner, "changed-after-merge");
});

test("uses the trusted candidate landing branch instead of the forge default", async (t) => {
  const state = fixture(t); const fake = forge(state);
  let observedBase = null;
  fake.observePullRequest = async ({ base }) => { observedBase = base; return { ...fake.pr, head_sha: state.head ?? state.candidate, base_ref: base }; };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788",
    deps: deps(state, fake, { base_branch: "release" }) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(observedBase, "release");
  assert.equal(result.result.base_branch, "release");
});

test("ignores an ambient landing-branch override", async (t) => {
  const state = fixture(t); const fake = forge(state); let observedBase = null;
  fake.observePullRequest = async ({ base }) => { observedBase = base; return { ...fake.pr, head_sha: state.head ?? state.candidate, base_ref: base }; };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788",
    deps: { ...deps(state, fake), env: { AGENT_LAUNCH_FORGE_LANDING_BRANCH: "release" } } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(observedBase, "main");
});

test("rejects credential-bearing canonical-looking remote URLs", async (t) => {
  const state = fixture(t); const fake = forge(state);
  git(state.repo, "remote", "set-url", "origin", "https://user:secret@github.com/agent-chassis/agent-chassis.git");
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY);
  assert.equal(result.detail.reason, "remote_not_canonical");
});

test("fallback PR observation binds the forge head selector to the handoff branch", async (t) => {
  const state = fixture(t); const fake = forge(state);
  const expectedBranch = `handoff/wk/IN-0030/WK-1788/${state.candidate}`;
  delete fake.observePullRequest;
  fake.listPullRequestPage = async ({ base, branch }) => {
    assert.equal(base, "main");
    assert.equal(branch, expectedBranch);
    return { items: [{ ...fake.pr, base_ref: base, head_ref: branch, head_sha: state.head ?? state.candidate }], has_next: false };
  };
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
});

function v3Fixture(t, { candidateDesignatesReviewUnit = false, recordInCandidate = true, extraDependency = false,
  parentClosure = undefined, closeoutDependency = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk-forge-merge-v3-"));
  const repo = path.join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "remote", "add", "origin", "https://github.com/agent-chassis/agent-chassis.git");
  const dependency = { id: "SLICE-018", title: "implementation", work_kind: "implementation", status: "todo", priority: "high", owner: "unassigned", updated: "2026-07-29", depends_on: [], read_scope: [], repo_paths: [], write_scope: [], acceptance: { criteria: [], validation: [] }, sections: {} };
  const secondDependency = { ...dependency, id: "SLICE-019", title: "second implementation" };
  const review = { id: "SLICE-009", title: "review", work_kind: "review", status: "todo", priority: "high", owner: "reviewer", depends_on: ["WK-1788#SLICE-018"], read_scope: ["AGENTS.md"], repo_paths: ["wiki/work-records/WK-1788.json"], write_scope: [], dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice", requires_graph_impact: false, requires_escalation: false }, acceptance: { criteria: ["review"], validation: ["node --test"] }, review_purpose: "terminal_whole_wk" };
  const base = { schema_version: "work-record.v1", id: "WK-1788", repo: "agent-chassis/agent-chassis", title: "merge", record_kind: "work_item", work_kind: "implementation", initiative: "IN-0030", status: "todo", priority: "medium", owner: "unassigned", created: "2026-07-28", updated: "2026-07-29", read_scope: [], repo_paths: [], write_scope: [], depends_on: [], blocks: [], related: [], children: [], acceptance: { criteria: [], validation: [] }, sections: parentClosure === undefined ? {} : { closure: parentClosure } };
  const candidateDependencies = extraDependency ? [dependency, secondDependency] : [dependency];
  const candidateRecord = { ...base, slices: candidateDesignatesReviewUnit ? [...candidateDependencies, review] : candidateDependencies };
  const localRecord = { ...base, status: "review", updated: "2026-07-30", slices: [
    ...(closeoutDependency
      ? [{ ...dependency, status: "done", updated: "2026-07-30", sections: { closure: { summary: "closed", validation: [], follow_ups: [] } } }]
      : [dependency]),
    ...(extraDependency ? [{ ...secondDependency, status: "todo" }] : []),
    { ...review, status: "review" }] };
  const v3Subject = "WK-1788#SLICE-009";
  const contractBinding = {
    schema_version: "agent_launch.terminal_review_contract_binding.v1",
    record_id: "WK-1788",
    initiative: "IN-0030",
    review_slice_id: "SLICE-009",
    review_subject: v3Subject,
    review_unit_contract: projectSliceReviewReceiptContracts(localRecord, "SLICE-009").slice_review_contract
  };
  const v3Digest = `sha256:${createHash("sha256").update(canonicalizeWorkRecordJson(contractBinding)).digest("hex")}`;
  mkdirSync(path.join(repo, "wiki/work-records"), { recursive: true });
  if (recordInCandidate) writeFileSync(path.join(repo, file), `${JSON.stringify(candidateRecord)}\n`);
  else writeFileSync(path.join(repo, "unrelated-candidate-content.txt"), "tree(W) carries no work record\n");
  const candidate = commit(repo, "candidate");
  writeFileSync(path.join(repo, file), `${JSON.stringify(localRecord, null, 2)}\n`);
  return { repo, candidate, localRecord, candidateRecord, v3Subject, v3Digest };
}

function v3Deps(state, fake) {
  return { forge: fake, allowCompatibilityValidator: true, verifyTerminalCandidateBinding: () => true,
    resolveTerminalCandidatePublicationState: async () => ({
      binding: { canonical_wk_id: "WK-1788", candidate: state.candidate,
        schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
        terminal_review_subject: state.v3Subject, terminal_review_contract_digest: state.v3Digest },
      branch: `handoff/wk/IN-0030/WK-1788/${state.candidate}`,

      initiative: "IN-0030"
    })
  };
}

test("v3 refuses unrelated owner drift against the candidate-bound record", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, owner: "untrusted" }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses unrelated sections.agent_notes drift against the candidate-bound record", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, sections: { agent_notes: "unreviewed coordination state" } }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses a live record that adds a parent closure", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord,
    sections: { closure: { summary: "unexpected", validation: [], follow_ups: [] } } }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses a live record that rewrites the candidate parent closure", async (t) => {
  const parentClosure = { summary: "reviewed", validation: ["green"], follow_ups: [] };
  const state = v3Fixture(t, { parentClosure }); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord,
    sections: { closure: { ...parentClosure, summary: "rewritten" } } }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 authenticates an unchanged parent closure", async (t) => {
  const parentClosure = { summary: "reviewed", validation: ["green"], follow_ups: [] };
  const state = v3Fixture(t, { parentClosure, closeoutDependency: false }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
});

test("v3 authenticates the single slice closeout with an unchanged parent closure", async (t) => {
  const parentClosure = { summary: "reviewed", validation: ["green"], follow_ups: [] };
  const state = v3Fixture(t, { parentClosure }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(state.repo, file))).sections, { closure: parentClosure });
});

test("v3 refuses a local record with an added non-terminal slice", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  const extra = { ...state.localRecord.slices[0], id: "SLICE-019", title: "added implementation", status: "todo", updated: "2026-07-29" };
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, slices: [...state.localRecord.slices, extra] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses a local record with a removed non-terminal slice", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, slices: [state.localRecord.slices[1]] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses closeout of two non-terminal slices", async (t) => {
  const state = v3Fixture(t, { extraDependency: true }); const fake = forge(state);
  const second = { ...state.localRecord.slices[1], status: "done", updated: "2026-07-30",
    sections: { closure: { summary: "closed", validation: [], follow_ups: [] } } };
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord,
    slices: [state.localRecord.slices[0], second, state.localRecord.slices[2]] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses a closeout closure with an extra key", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  const dependency = { ...state.localRecord.slices[0], sections: { closure: { summary: "closed", validation: [], follow_ups: [], extra: true } } };
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, slices: [dependency, state.localRecord.slices[1]] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 refuses a closeout closure with a non-string summary", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  const dependency = { ...state.localRecord.slices[0], sections: { closure: { summary: 42, validation: [], follow_ups: [] } } };
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord, slices: [dependency, state.localRecord.slices[1]] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 authenticates a cold reconstruction whose candidate designates no review unit", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).status, "done");
});

test("v3 refuses a canonical record whose review contract disagrees with the binding", async (t) => {
  const state = v3Fixture(t); const fake = forge(state);
  writeFileSync(path.join(state.repo, file), JSON.stringify({
    ...state.localRecord,
    slices: state.localRecord.slices.map((slice) => slice.id === "SLICE-009"
      ? { ...slice, acceptance: { criteria: ["changed contract"], validation: [] } }
      : slice)
  }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
});

test("v3 authenticates a cold reconstruction whose candidate carries no work record at all", async (t) => {
  const state = v3Fixture(t, { recordInCandidate: false }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
});

test("v3 still authenticates when the candidate does designate the review unit", async (t) => {
  const state = v3Fixture(t, { candidateDesignatesReviewUnit: true }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
});

test("refuses a terminal dependency qualified to a different WK", async (t) => {
  const state = fixture(t, { dependencyRef: "WK-9999#SLICE-018" }); const fake = forge(state);

  assert.equal(state.localRecord.slices[0].id, "SLICE-018");
  assert.equal(state.localRecord.slices[0].status, "done");
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
  assert.equal(git(state.repo, "rev-parse", "HEAD"), state.candidate);
});

test("authenticates a terminal dependency qualified to this WK", async (t) => {
  const state = fixture(t, { dependencyRef: "WK-1788#SLICE-018" }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).status, "done");
});

test("authenticates an unqualified terminal dependency", async (t) => {
  const state = fixture(t, { dependencyRef: "SLICE-018" }); const fake = forge(state);
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).status, "done");
});

test("v3 refuses a closeout of an ordinary slice the terminal unit does not declare", async (t) => {
  const state = v3Fixture(t, { extraDependency: true, closeoutDependency: false }); const fake = forge(state);

  assert.deepEqual(state.localRecord.slices[2].depends_on, ["WK-1788#SLICE-018"]);
  assert.equal(state.localRecord.slices[1].id, "SLICE-019");
  const undeclared = { ...state.localRecord.slices[1], status: "done", updated: "2026-07-30",
    sections: { closure: { summary: "closed", validation: [], follow_ups: [] } } };
  writeFileSync(path.join(state.repo, file), JSON.stringify({ ...state.localRecord,
    slices: [state.localRecord.slices[0], undeclared, state.localRecord.slices[2]] }));
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "local_WK_not_authenticated_against_candidate");
  assert.equal(fake.calls.cas, 0); assert.equal(fake.calls.merge, 0);
  assert.equal(git(state.repo, "rev-parse", "HEAD"), state.candidate);
});

test("v3 authenticates the declared same-WK closeout alongside an untouched sibling slice", async (t) => {
  const state = v3Fixture(t, { extraDependency: true }); const fake = forge(state);
  assert.deepEqual(state.localRecord.slices[2].depends_on, ["WK-1788#SLICE-018"]);
  assert.equal(state.localRecord.slices[0].id, "SLICE-018");
  assert.equal(state.localRecord.slices[0].status, "done");
  const result = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: v3Deps(state, fake) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.calls.cas, 1); assert.equal(fake.calls.merge, 1);
  assert.equal(JSON.parse(readFileSync(path.join(state.repo, file))).status, "done");
});

test("v3 re-authenticates the closeout chain on retry after a failed forge merge", async (t) => {
  const state = v3Fixture(t); const fake = forge(state, { failMerge: true }); const shared = v3Deps(state, fake);
  const first = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(first.category, WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE);
  assert.equal(fake.calls.cas, 1);
  fake.mergePullRequest = async ({ expectedHead }) => {
    fake.calls.merge++; assert.equal(expectedHead, state.head);
    fake.pr.merged = true; fake.pr.state = "closed"; return { ok: true, merged: true };
  };
  const second = await defaultWkForgeMerge({ mainRepo: state.repo, assignedUnit: "WK-1788", deps: shared });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(fake.calls.cas, 1);
});
