import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authenticateWkCloseoutChain,
  defaultRunGit,
  defaultWkForgeHandoff
} from "../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import {
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { materializeTerminalCandidateCheckout } from
  "../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk-closeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "remote", "add", "origin", "https://github.com/agent-chassis/agent-chassis.git");
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  commit(root, "base");
  mkdirSync(path.join(root, "wiki", "work-records"), { recursive: true });
  const file = path.join(root, "wiki", "work-records", "WK-1788.json");
  const base = {
    id: "WK-1788", initiative: "IN-0030", status: "todo", title: "closeout",
    slices: [{ id: "REVIEW", work_kind: "review", review_purpose: "terminal_whole_wk", status: "todo" }]
  };
  writeFileSync(file, JSON.stringify(base));
  const candidate = commit(root, "candidate");
  writeFileSync(file, JSON.stringify({
    ...base, status: "review", slices: [{ ...base.slices[0], status: "review" }]
  }));
  const review = commit(root, "review state");
  writeFileSync(file, JSON.stringify({ ...base, status: "done", slices: [{ ...base.slices[0], status: "review" }] }));
  const completion = commit(root, "completion");
  return { root, candidate, review, completion, file };
}

test("authenticates only the exact C-to-review-to-done WK-only chain", (t) => {
  const state = fixture(t);
  const result = authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: state.completion,
    deps: { runGit: defaultRunGit }
  });
  assert.deepEqual(result, { head: state.completion, review_state: state.review });
});

test("rejects partial, malformed, unrelated, and non-WK descendants", (t) => {
  const state = fixture(t);
  const run = { runGit: defaultRunGit };
  assert.deepEqual(authenticateWkCloseoutChain({ ...run, mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: state.review }), {
    head: state.review, review_state: state.review
  });
  assert.equal(authenticateWkCloseoutChain({ ...run, mainRepo: state.root, wk: "WK-9999", candidate: state.candidate, head: state.completion }), null);
  writeFileSync(path.join(state.root, "unrelated.txt"), "nope\n");
  const unrelated = commit(state.root, "unrelated descendant");
  assert.equal(authenticateWkCloseoutChain({ ...run, mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: unrelated }), null);

  writeFileSync(state.file, JSON.stringify({
    ...JSON.parse(git(state.root, "show", `${state.completion}:wiki/work-records/WK-1788.json`)),
    status: "done"
  }));
  writeFileSync(path.join(state.root, "second-unrelated.txt"), "nope\n");
  const nonWk = commit(state.root, "WK closeout plus unrelated path");
  assert.equal(authenticateWkCloseoutChain({ ...run, mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: nonWk }), null);

  git(state.root, "checkout", "-q", "--detach", state.completion);
  git(state.root, "checkout", "-q", "-b", "malformed-parent");
  writeFileSync(path.join(state.root, "malformed-parent.txt"), "second parent\n");
  const secondParent = commit(state.root, "second parent");
  git(state.root, "checkout", "-q", "--detach", state.completion);
  git(state.root, "merge", "--no-ff", "-q", "-m", "malformed merge", secondParent);
  const malformed = git(state.root, "rev-parse", "HEAD");
  assert.equal(authenticateWkCloseoutChain({ ...run, mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: malformed }), null);
});

test("keeps the legacy exact-candidate head outside closeout recovery", (t) => {
  const state = fixture(t);
  assert.equal(authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: state.candidate,
    deps: { runGit: defaultRunGit }
  }), null);
});

test("rejects review-state records outside the terminal projection", (t) => {
  const state = fixture(t);
  const pathToRecord = state.file;
  writeFileSync(pathToRecord, JSON.stringify({
    id: "WK-1788", status: "review", title: "tampered",
    slices: [{ id: "REVIEW", work_kind: "review", review_purpose: "terminal_whole_wk", status: "review" }]
  }));
  commit(state.root, "altered review state");
  writeFileSync(pathToRecord, JSON.stringify({
    id: "WK-1788", status: "done", title: "tampered",
    slices: [{ id: "REVIEW", work_kind: "review", review_purpose: "terminal_whole_wk", status: "review" }]
  }));
  const alteredCompletion = commit(state.root, "altered completion");
  assert.equal(authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: alteredCompletion,
    deps: { runGit: defaultRunGit }
  }), null);
});

test("rejects WK-only closeout commits that change the record file mode", (t) => {
  const state = fixture(t);
  writeFileSync(state.file, JSON.stringify({
    ...JSON.parse(git(state.root, "show", `${state.candidate}:wiki/work-records/WK-1788.json`)),
    status: "review", slices: [{ id: "REVIEW", work_kind: "review", review_purpose: "terminal_whole_wk", status: "review" }]
  }));
  chmodSync(state.file, 0o755);
  const review = commit(state.root, "review state with mode change");
  writeFileSync(state.file, JSON.stringify({
    ...JSON.parse(git(state.root, "show", `${review}:wiki/work-records/WK-1788.json`)), status: "done"
  }));
  const completion = commit(state.root, "completion");
  assert.equal(authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: completion,
    deps: { runGit: defaultRunGit }
  }), null);
});

test("rejects an arbitrary review slice without terminal whole-WK purpose", (t) => {
  const state = fixture(t);
  writeFileSync(state.file, JSON.stringify({
    ...JSON.parse(readFileSync(state.file, "utf8")), status: "review",
    slices: [{ id: "REVIEW", work_kind: "review", status: "done" }]
  }));
  commit(state.root, "arbitrary review state");
  writeFileSync(state.file, JSON.stringify({
    id: "WK-1788", status: "done", title: "closeout",
    slices: [{ id: "REVIEW", work_kind: "review", status: "done" }]
  }));
  const alteredCompletion = commit(state.root, "arbitrary completion");
  assert.equal(authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: alteredCompletion,
    deps: { runGit: defaultRunGit }
  }), null);
});

test("accepts a terminal review slice added after the candidate", (t) => {
  const state = fixture(t);
  const candidateRecord = JSON.parse(git(state.root, "show", `${state.candidate}:wiki/work-records/WK-1788.json`));
  const preReviewRecord = { ...candidateRecord, slices: [] };
  writeFileSync(state.file, JSON.stringify(preReviewRecord));
  const candidateWithoutReview = commit(state.root, "candidate without terminal review slice");
  writeFileSync(state.file, JSON.stringify({
    ...preReviewRecord,
    status: "review",
    slices: [...preReviewRecord.slices, {
      id: "SLICE-009", title: "terminal review", work_kind: "review", owner: "reviewer",
      priority: "medium", depends_on: [], read_scope: ["AGENTS.md"],
      repo_paths: ["wiki/work-records/WK-1788.json"], write_scope: [],
      dispatch_intent: {
        intended_agent_role: "reviewer", target_unit: "slice",
        requires_graph_impact: false, requires_escalation: false
      },
      acceptance: { criteria: ["review"], validation: ["node --test"] },
      review_purpose: "terminal_whole_wk", status: "review"
    }]
  }));
  const review = commit(state.root, "review state with terminal slice");
  writeFileSync(state.file, JSON.stringify({
    ...JSON.parse(git(state.root, "show", `${review}:wiki/work-records/WK-1788.json`)), status: "done"
  }));
  const completion = commit(state.root, "completion");
  assert.deepEqual(authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: candidateWithoutReview, head: completion,
    deps: { runGit: defaultRunGit }
  }), { head: completion, review_state: review });
});

test("rejects non-terminal or non-append slice additions during closeout recovery", (t) => {
  const state = fixture(t);
  const candidateRecord = JSON.parse(git(state.root, "show", `${state.candidate}:wiki/work-records/WK-1788.json`));
  const preReviewRecord = { ...candidateRecord, slices: [] };
  writeFileSync(state.file, JSON.stringify(preReviewRecord));
  const candidate = commit(state.root, "candidate without terminal review slice");
  for (const slices of [
    [{ id: "SLICE-009", work_kind: "implementation", status: "review" }],
    [{ id: "SLICE-009", work_kind: "review", review_purpose: "terminal_whole_wk", status: "todo" }],
    [{ id: "SLICE-009", work_kind: "review", review_purpose: "terminal_whole_wk", status: "review" },
      { id: "SLICE-010", work_kind: "review", review_purpose: "terminal_whole_wk", status: "review" }]
  ]) {
    writeFileSync(state.file, JSON.stringify({ ...preReviewRecord, status: "review", slices }));
    const review = commit(state.root, "invalid review state");
    writeFileSync(state.file, JSON.stringify({ ...preReviewRecord, status: "done", slices }));
    const completion = commit(state.root, "invalid completion");
    assert.equal(authenticateWkCloseoutChain({
      mainRepo: state.root, wk: "WK-1788", candidate, head: completion,
      deps: { runGit: defaultRunGit }
    }), null);
    assert.notEqual(review, completion);
  }
});

test("rejects a terminal slice with worker-shaped review metadata", (t) => {
  const state = fixture(t);
  const candidateRecord = JSON.parse(git(state.root, "show", `${state.candidate}:wiki/work-records/WK-1788.json`));
  const preReviewRecord = { ...candidateRecord, slices: [] };
  writeFileSync(state.file, JSON.stringify(preReviewRecord));
  const candidate = commit(state.root, "candidate without terminal review slice");
  const terminalSlice = {
    id: "SLICE-009", title: "terminal review", work_kind: "review", owner: "reviewer",
    priority: "medium", depends_on: [], read_scope: ["AGENTS.md"],
    repo_paths: ["wiki/work-records/WK-1788.json"], write_scope: [],
    dispatch_intent: {
      intended_agent_role: "reviewer", target_unit: "slice",
      requires_graph_impact: false, requires_escalation: false
    },
    acceptance: { criteria: ["review"], validation: ["node --test"] },
    review_purpose: "terminal_whole_wk", status: "review"
  };
  for (const mutation of [
    { write_scope: ["packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs"] },
    { dispatch_intent: { ...terminalSlice.dispatch_intent, intended_agent_role: "worker" } }
  ]) {
    writeFileSync(state.file, JSON.stringify({
      ...preReviewRecord, status: "review", slices: [{ ...terminalSlice, ...mutation }]
    }));
    const review = commit(state.root, "non-canonical terminal review state");
    writeFileSync(state.file, JSON.stringify({
      ...preReviewRecord, status: "done", slices: [{ ...terminalSlice, ...mutation }]
    }));
    const completion = commit(state.root, "non-canonical completion");
    assert.equal(authenticateWkCloseoutChain({
      mainRepo: state.root, wk: "WK-1788", candidate, head: completion,
      deps: { runGit: defaultRunGit }
    }), null);
    assert.notEqual(review, completion);
  }
});

async function publicRecoveryResult(t, { reviewChanges = {}, completionChanges = {}, prHead = "completion" } = {}) {
  const state = fixture(t);
  const candidate = state.candidate;
  const record = JSON.parse(git(state.root, "show", `${candidate}:wiki/work-records/WK-1788.json`));
  git(state.root, "branch", "wk/IN-0030/WK-1788", candidate);
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: state.root, baseSha: git(state.root, "rev-parse", `${candidate}^`), baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1788", canonicalWkId: "WK-1788",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
  const binding = constructTerminalWkCandidate({ frozen });
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), "wk-closeout-candidate-"));
  t.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  const materialization = materializeTerminalCandidateCheckout({
    binding, candidateRoot, runGit: defaultTerminalCandidateRunGit
  });
  git(state.root, "checkout", "--detach", "-q", binding.candidate);
  const reviewRecord = {
    ...record, ...reviewChanges, status: "review",
    slices: [{ ...record.slices[0], status: "review" }]
  };
  writeFileSync(state.file, JSON.stringify(reviewRecord));
  const review = commit(state.root, "review state");
  const completionRecord = { ...reviewRecord, ...completionChanges, status: "done" };
  writeFileSync(state.file, JSON.stringify(completionRecord));
  const completion = commit(state.root, "completion");
  const observedHead = prHead === "review" ? review : prHead === "candidate" ? candidate : completion;
  const forge = {
    repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
    probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: async () => ({ kind: "present", sha: completion }),
    listPullRequestPage: async () => ({ kind: "ok", has_next: false, items: [{
      number: 1, state: "open", merged: false, mergeable_state: "clean",
      url: "https://github.com/agent-chassis/agent-chassis/pull/1",
      repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
      base_ref: "main", head_ref: `handoff/wk/IN-0030/WK-1788/${binding.candidate}`,
      head_sha: observedHead
    }] }),
    publishBranchIfAbsent: async () => ({ kind: "published" }),
    createPullRequest: async () => ({ kind: "uncertain" })
  };
  return defaultWkForgeHandoff({
    mainRepo: state.root, assignedUnit: "WK-1788",
    deps: { forge, resolveTerminalCandidatePublicationState: async () => ({ binding, materialization }) }
  });
}

test("public executor refuses review-state mutation outside the terminal projection", async (t) => {
  const result = await publicRecoveryResult(t, { reviewChanges: { title: "tampered" } });
  assert.equal(result.ok, false);
});

test("public executor refuses completion mutation beyond parent status", async (t) => {
  const result = await publicRecoveryResult(t, { completionChanges: { title: "tampered" } });
  assert.equal(result.ok, false);
});

test("public executor requires the PR head to equal the recovered closeout head", async (t) => {
  const state = fixture(t);
  const candidate = state.candidate;
  const record = JSON.parse(git(state.root, "show", `${candidate}:wiki/work-records/WK-1788.json`));
  git(state.root, "branch", "wk/IN-0030/WK-1788", candidate);
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: state.root, baseSha: git(state.root, "rev-parse", `${candidate}^`), baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1788", canonicalWkId: "WK-1788",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
  const binding = constructTerminalWkCandidate({ frozen });
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), "wk-closeout-candidate-"));
  t.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  const materialization = materializeTerminalCandidateCheckout({
    binding, candidateRoot,
    runGit: defaultTerminalCandidateRunGit
  });
  git(state.root, "checkout", "--detach", "-q", binding.candidate);
  writeFileSync(state.file, JSON.stringify({
    ...record, status: "review", slices: [{ ...record.slices[0], status: "review" }]
  }));
  const review = commit(state.root, "review state");
  writeFileSync(state.file, JSON.stringify({
    ...record, status: "done", slices: [{ ...record.slices[0], status: "review" }]
  }));
  const completion = commit(state.root, "completion");
  const forge = {
    repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
    probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: async () => ({ kind: "present", sha: completion }),
    listPullRequestPage: async () => ({ kind: "ok", has_next: false, items: [{
      number: 1, state: "open", merged: false, mergeable_state: "clean",
      url: "https://github.com/agent-chassis/agent-chassis/pull/1",
      repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
      base_ref: "main", head_ref: `handoff/wk/IN-0030/WK-1788/${binding.candidate}`,
      head_sha: review
    }] }),
    publishBranchIfAbsent: async () => ({ kind: "published" }),
    createPullRequest: async () => ({ kind: "uncertain" })
  };
  const result = await defaultWkForgeHandoff({
    mainRepo: state.root, assignedUnit: "WK-1788",
    deps: {
      forge,
      resolveTerminalCandidatePublicationState: async () => ({ binding, materialization })
    }
  });
  assert.equal(review !== completion, true);
  assert.equal(result.ok, false);
});

test("public executor rejects a stale PR head at the candidate when branch is at completion", async (t) => {
  const result = await publicRecoveryResult(t, { prHead: "candidate" });
  assert.equal(result.ok, false);
});
