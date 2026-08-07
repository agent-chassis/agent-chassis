import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTerminalCandidateCoordinator } from
  "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { createTerminalCandidateReviewTarget } from
  "../packages/wiki-mcp/src/lib/dispatch-terminal-review-evidence.mjs";
import {
  assertRetainedReviewerLaunchIdentityMatchesContext,
  createRetainedReviewerLaunchIdentity
} from "../packages/agent-launch-cli/src/lib/backend-review-identity.mjs";
import { FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION } from
  "../packages/agent-launch-cli/src/lib/workspace-agent-findings-role-context.mjs";
import { defaultWkForgeHandoff } from
  "../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import {
  constructTerminalWkCandidate,
  freezeTerminalWkCandidateInputs
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

const REPOSITORY = Object.freeze({
  host: "github.com",
  owner: "agent-chassis",
  name: "agent-chassis",
  https_url: "https://github.com/agent-chassis/agent-chassis.git"
});

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function makeWritable(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(target, 0o700);
  for (const entry of readdirSync(target)) makeWritable(path.join(target, entry));
}

function makeFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1634-e2e-"));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => {
    makeWritable(root);
    rmSync(root, { recursive: true, force: true });
  });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "remote", "add", "origin", REPOSITORY.https_url);
  writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "wk1634-e2e", private: true }));
  const lock = JSON.stringify({ name: "wk1634-e2e", lockfileVersion: 3, packages: { "": { name: "wk1634-e2e" } } });
  writeFileSync(path.join(repo, "package-lock.json"), lock);
  mkdirSync(path.join(repo, "tests"));
  writeFileSync(path.join(repo, "tests", "whole-wk.test.mjs"),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok',()=>assert.equal(process.env.FORGE_TOKEN,undefined));\n");
  const record = {
    schema_version: "work-record.v1",
    id: "WK-1634",
    initiative: "IN-0030",
    title: "terminal candidate end to end",
    status: "review",
    sections: { structured_validation: { allowed: [{ command: "node_test", target: "tests/whole-wk.test.mjs" }] } },
    acceptance: { criteria: ["exact candidate"], validation: ["node --test tests/whole-wk.test.mjs"] },
    slices: [
      { id: "SLICE-007", work_kind: "implementation", status: "review" },
      {
        id: "SLICE-099",
        work_kind: "review",
        review_purpose: "terminal_whole_wk",
        status: "todo",
        write_scope: [],
        dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
        acceptance: { criteria: ["findings only"] }
      }
    ]
  };
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(repo, "wiki", "work-records", "WK-1634.json"), JSON.stringify(record));
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const B = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "wk/IN-0030/WK-1634");
  git(repo, "checkout", "-q", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "wk.txt"), "complete WK delta\n");
  git(repo, "add", "wk.txt");
  git(repo, "commit", "-q", "-m", "wk");
  const W = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "main");
  writeFileSync(path.join(repo, "landing.txt"), "landing only\n");
  git(repo, "add", "landing.txt");
  git(repo, "commit", "-q", "-m", "landing");
  const L = git(repo, "rev-parse", "HEAD");
  mkdirSync(path.join(repo, "node_modules"));
  writeFileSync(path.join(repo, "node_modules", ".package-lock.json"), lock);
  return { root, repo, worktrees, record, B, L, W };
}

async function reviewedCycle(state) {
  const coordinator = createTerminalCandidateCoordinator({ mainRepo: state.repo, worktreeRoot: state.worktrees });
  const canonical = JSON.stringify(state.record);
  const reviewUnit = Object.freeze({
    record_id: "WK-1634",
    initiative: "IN-0030",
    subject: "WK-1634#SLICE-099",
    canonical_parent_wk_contract: canonical,
    review_unit_contract: "findings-only terminal review"
  });
  const terminalCandidate = await coordinator.prepareTerminalCandidate({
    integration: { wk_ref: "refs/heads/wk/IN-0030/WK-1634", wk_sha: state.W },
    reviewUnit,
    wkId: "WK-1634",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    baseSha: state.B,
    baseRef: "main"
  });
  const validations = await coordinator.validateTerminalCandidate({ terminalCandidate });
  assert.equal(validations.length, 1);
  assert.equal(validations[0].ok, true);
  const target = createTerminalCandidateReviewTarget(terminalCandidate);
  const context = Object.freeze({
    review_identity_kind: "terminal_candidate",
    main_repo: state.repo,
    review_subject: reviewUnit.subject,
    record_id: "WK-1634",
    review_slice_id: "SLICE-099",
    initiative: "IN-0030",
    candidate_ref: target.candidate_ref,
    candidate_sha: target.candidate_sha,
    base_ref: target.base_ref,
    base_sha: target.base_sha,
    wk_ref: target.wk_ref,
    wk_sha: target.wk_sha,
    worktree_path: target.worktree_path,
    diff_head_sha: target.diff_head_sha,
    canonical_wk_digest: target.canonical_wk_digest,
    trusted_frozen_review_contract: Object.freeze({
      schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
      review_subject: reviewUnit.subject,
      canonical_parent_wk_contract: canonical,
      review_unit_contract: reviewUnit.review_unit_contract
    })
  });
  const identity = createRetainedReviewerLaunchIdentity(context);
  assertRetainedReviewerLaunchIdentityMatchesContext(identity, context);
  return Object.freeze({
    binding: terminalCandidate.binding,
    materialization: terminalCandidate.materialization,
    validation: validations[0],
    reviewer_run_id: "reviewer-clean",
    reviewer_identity: identity,
    review_result: Object.freeze({ clean_review: true })
  });
}

function forgeFor(state, candidate) {
  const branches = new Map([["main", state.L]]);
  const prs = [];
  return {
    repository: REPOSITORY,
    probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: ({ branch }) => branches.has(branch)
      ? { kind: "present", sha: branches.get(branch) }
      : { kind: "absent" },
    publishBranchIfAbsent: ({ branch, commit }) => {
      branches.set(branch, commit);
      return { kind: "published" };
    },
    listPullRequestPage: ({ base, head }) => ({
      kind: "ok",
      items: prs.filter((pr) => pr.base_ref === base && pr.head_ref === head),
      has_next: false
    }),
    createPullRequest: ({ base, head }) => {
      prs.push({
        number: 1,
        state: "open",
        merged: false,
        url: "https://example.invalid/1",
        mergeable_state: "clean",
        base_ref: base,
        head_ref: head,
        head_sha: candidate,
        repository: REPOSITORY
      });
      return { kind: "created", pull_request: prs[0] };
    }
  };
}

test("same exact C/L/W passes validation, final-review binding, and byte-identical publication", async (t) => {
  const state = makeFixture(t);
  const reviewed = await reviewedCycle(state);
  const forge = forgeFor(state, reviewed.binding.candidate);
  const published = await defaultWkForgeHandoff({
    mainRepo: state.repo,
    assignedUnit: "WK-1634",
    deps: {
      forge,
      resolveTerminalCandidatePublicationState: async () => reviewed
    }
  });
  assert.equal(published.ok, true, JSON.stringify(published));
  assert.equal(reviewed.validation.candidate, reviewed.binding.candidate);
  assert.equal(reviewed.reviewer_identity.candidate_sha, reviewed.binding.candidate);
  assert.equal(reviewed.reviewer_identity.base_sha, state.B);
  assert.equal(published.result.commit, reviewed.binding.candidate);
  assert.equal(published.result.parent, state.B);
  assert.equal(git(state.repo, "rev-parse", "refs/heads/wk/IN-0030/WK-1634"), state.W);
});

test("cold restart re-derives L/W/B/C and mints a fresh projection without monitor or historical binding state", async (t) => {
  const state = makeFixture(t);

  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: state.repo,
    baseSha: state.B,
    baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"ab".repeat(32)}`
  });
  const original = constructTerminalWkCandidate({ frozen });
  git(state.repo, "update-ref", "refs/heads/main", state.W);
  const objectsBeforeRecovery = git(state.repo, "count-objects", "-v");
  const refsBeforeRecovery = git(state.repo, "for-each-ref", "--format=%(refname) %(objectname)");
  const freshCoordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees
  });
  const recovered = await freshCoordinator.recoverTerminalCandidate("WK-1634");
  assert.equal(recovered.binding.candidate, original.candidate);
  assert.equal(recovered.binding.base, state.B);
  assert.equal(recovered.binding.wk_tip, state.W);
  assert.equal(recovered.binding.candidate_tree, original.candidate_tree);
  assert.equal(recovered.binding.candidate_parent, state.B);
  assert.equal(recovered.binding.candidate_ref_state, "recovered");
  assert.equal(git(state.repo, "count-objects", "-v"), objectsBeforeRecovery,
    "restart recovery must not write a Git object");
  assert.equal(git(state.repo, "for-each-ref", "--format=%(refname) %(objectname)"), refsBeforeRecovery,
    "restart recovery must not create or move a Git ref");

  const published = await defaultWkForgeHandoff({
    mainRepo: state.repo,
    assignedUnit: "WK-1634",
    deps: {
      forge: forgeFor(state, recovered.binding.candidate),
      resolveTerminalCandidatePublicationState: async () => ({
        binding: recovered.binding,
        materialization: recovered.materialization,
        advisory_review_evidence: {
          authority: "advisory_only",
          reviews: [],
          observation: "review_history_not_required_for_restart_recovery"
        }
      })
    }
  });
  assert.equal(published.ok, true, JSON.stringify(published));
  assert.equal(published.result.commit, original.candidate);
  assert.equal(published.result.boundary_authorization.policy_posture, "free_substrate");
});

const NON_GATING_DEPENDENCY_CASES = Object.freeze([
  ["a version-only package.json bump", (state) => {
    writeFileSync(path.join(state.repo, "package.json"),
      JSON.stringify({ name: "wk1634-e2e", private: true, version: "0.5.5" }));
  }],
  ["a real dependency declaration change", (state) => {
    writeFileSync(path.join(state.repo, "package.json"), JSON.stringify({
      name: "wk1634-e2e", private: true, dependencies: { "brand-new-dep": "^4.2.0" }
    }));
  }],
  ["a lockfile change", (state) => {
    writeFileSync(path.join(state.repo, "package-lock.json"), JSON.stringify({
      name: "wk1634-e2e", lockfileVersion: 3,
      packages: { "": { name: "wk1634-e2e", dependencies: { "brand-new-dep": "^4.2.0" } } }
    }));
  }],
  ["a workspace-manifest change", (state) => {
    writeFileSync(path.join(state.repo, "package.json"), JSON.stringify({
      name: "wk1634-e2e", private: true, workspaces: ["packages/*"]
    }));
  }],
  ["an absent installed dependency tree", (state) => {
    rmSync(path.join(state.repo, "node_modules"), { recursive: true, force: true });
  }],
  ["an absent install marker", (state) => {
    rmSync(path.join(state.repo, "node_modules", ".package-lock.json"), { force: true });
  }],

  ["an unavailable declared project-test target", (state) => {
    git(state.repo, "checkout", "-q", "wk/IN-0030/WK-1634");
    rmSync(path.join(state.repo, "tests", "whole-wk.test.mjs"), { force: true });
    git(state.repo, "add", "-A");
    git(state.repo, "commit", "-q", "-m", "the WK drops the declared project test");
    state.W = git(state.repo, "rev-parse", "HEAD");
    git(state.repo, "checkout", "-q", "main");
  }, { targetAvailable: false }]
]);

for (const [label, drift, expected = {}] of NON_GATING_DEPENDENCY_CASES) {
  test(`${label} neither invalidates the exact candidate nor blocks handoff`, async (t) => {
    const state = makeFixture(t);
    drift(state);
    const coordinator = createTerminalCandidateCoordinator({
      mainRepo: state.repo,
      worktreeRoot: state.worktrees
    });
    const terminalCandidate = await coordinator.prepareTerminalCandidate({
      integration: { wk_ref: "refs/heads/wk/IN-0030/WK-1634", wk_sha: state.W },
      reviewUnit: { record_id: "WK-1634", initiative: "IN-0030" },
      wkId: "WK-1634",
      wkRef: "refs/heads/wk/IN-0030/WK-1634",
      baseSha: state.B,
      baseRef: "main"
    });

    assert.equal(terminalCandidate.binding.base, state.B);
    assert.equal(terminalCandidate.binding.candidate_parent, state.B);
    assert.equal(terminalCandidate.binding.wk_tip, state.W);
    assert.equal(git(state.repo, "rev-parse", `${terminalCandidate.binding.candidate}^{tree}`),
      git(state.repo, "rev-parse", `${state.W}^{tree}`));
    assert.equal(
      git(state.repo, "rev-list", "--parents", "-n", "1", terminalCandidate.binding.candidate)
        .split(/\s+/).length,
      2
    );

    const validations = await coordinator.validateTerminalCandidate({ terminalCandidate });
    assert.equal(validations.length, 1);
    assert.equal(validations[0].advisory, true);
    assert.equal(validations[0].integration_effect, "none");
    assert.equal(validations[0].candidate, terminalCandidate.binding.candidate);
    if (expected.targetAvailable !== undefined) {
      assert.equal(validations[0].target_available, expected.targetAvailable);
      assert.deepEqual(validations[0].steps.map((step) => step.ran), [false, false]);
    }

    const published = await defaultWkForgeHandoff({
      mainRepo: state.repo,
      assignedUnit: "WK-1634",
      deps: {
        forge: forgeFor(state, terminalCandidate.binding.candidate),
        resolveTerminalCandidatePublicationState: async () => ({
          binding: terminalCandidate.binding,
          materialization: terminalCandidate.materialization,
          advisory_review_evidence: { authority: "advisory_only", reviews: [] }
        })
      }
    });
    assert.equal(published.ok, true, JSON.stringify(published));
    assert.equal(published.result.commit, terminalCandidate.binding.candidate);
    assert.equal(published.result.parent, state.B);
    assert.equal(published.result.boundary_authorization.policy_posture, "free_substrate");
    assert.equal(git(state.repo, "rev-parse", "refs/heads/wk/IN-0030/WK-1634"), state.W);
  });
}

for (const movement of ["wk", "checkout"]) {
  test(`post-review ${movement} movement invalidates publication`, async (t) => {
    const state = makeFixture(t);
    const reviewed = await reviewedCycle(state);
    if (movement === "wk") git(state.repo, "update-ref", "refs/heads/wk/IN-0030/WK-1634", state.L);
    if (movement === "checkout") {
      writeFileSync(path.join(reviewed.materialization.checkout_path, "drift.txt"), "drift\n");
    }
    const published = await defaultWkForgeHandoff({
      mainRepo: state.repo,
      assignedUnit: "WK-1634",
      deps: {
        forge: forgeFor(state, reviewed.binding.candidate),
        resolveTerminalCandidatePublicationState: async () => reviewed
      }
    });
    assert.equal(published.ok, false);
  });
}
