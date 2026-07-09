

import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION,
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES as CODES,
  WORKTREE_PROVISIONING_ISOLATION_INVARIANT,
  WorktreeProvisioningDispatchError,
  assertExpectedEnvelopePresent,
  provisionWorktreeAtDispatch
} from "../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch.mjs";
import {
  integrationBranchRef,
  perWkBranchRef
} from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";

const MAIN_REPO = "/abs/repo";
const WORKTREE_ROOT = "/abs/wt";
const INITIATIVE = "IN-0017";
const SUBJECT = "WK-1432";
const LAUNCH_REF = "lr-1";
const RUN_ID = "run-1";

const INTEGRATION_REF = integrationBranchRef(INITIATIVE);
const PER_WK_REF = perWkBranchRef(INITIATIVE, SUBJECT);
const RECORD_IN_TREE = `wiki/work-records/${SUBJECT}.json`;

function recordWithExpected(extra = {}) {
  return JSON.stringify({ id: SUBJECT, expected: { envelope: "v1" }, ...extra });
}

function makeGit(spec, events) {
  const branches = spec.branches ?? {};
  const trees = spec.trees ?? {};
  const ancestors = spec.ancestors ?? [];
  return function runGit({ repo, args }) {
    events.push(`git:${args[0]}`);
    assert.equal(repo, MAIN_REPO, "runGit must be called against the main repo");
    const [cmd] = args;
    if (cmd === "show-ref") {
      const full = args[args.length - 1];
      const ref = full.replace(/^refs\/heads\//, "");
      return Object.prototype.hasOwnProperty.call(branches, ref)
        ? { ok: true, stdout: "" }
        : { ok: false, status: 1 };
    }
    if (cmd === "rev-parse") {
      const spec2 = args[args.length - 1];
      const ref = spec2.replace(/\^\{commit\}$/, "");
      const sha = branches[ref];
      if (typeof sha === "string" && sha.length > 0) return { ok: true, stdout: `${sha}\n` };
      return { ok: false, status: 1, stdout: "" };
    }
    if (cmd === "show") {
      const key = args[1];
      if (Object.prototype.hasOwnProperty.call(trees, key)) {
        return { ok: true, stdout: trees[key] };
      }
      return { ok: false, status: 128, stderr: "fatal: path not in tree" };
    }
    if (cmd === "merge-base") {
      const a = args[2];
      const b = args[3];
      const isAncestor = ancestors.some(([x, y]) => x === a && y === b);
      return isAncestor ? { ok: true, stdout: "" } : { ok: false, status: 1 };
    }
    throw new Error(`unexpected git invocation in test fake: git ${args.join(" ")}`);
  };
}

function expectCode(fn, code, message) {
  assert.throws(
    fn,
    (err) => {
      assert.ok(
        err instanceof WorktreeProvisioningDispatchError,
        `expected WorktreeProvisioningDispatchError, got: ${err && err.name}: ${err && err.message}`
      );
      assert.equal(err.code, code, message);
      return true;
    }
  );
}

test("(a) gate passes and reports the record-level source when `expected` is present", () => {
  const events = [];
  const runGit = makeGit(
    { trees: { [`int1:${RECORD_IN_TREE}`]: recordWithExpected() } },
    events
  );
  const result = assertExpectedEnvelopePresent({
    runGit,
    mainRepo: MAIN_REPO,
    baseSha: "int1",
    subject: SUBJECT
  });
  assert.deepEqual(result, { present: true, baseSha: "int1", source: "expected" });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(events, ["git:show"]);
});

test("(a) gate REFUSES EXPECTED_ENVELOPE_MISSING when `expected` is absent or empty", () => {
  for (const rec of [
    JSON.stringify({ id: SUBJECT }),
    JSON.stringify({ id: SUBJECT, expected: {} }),
    JSON.stringify({ id: SUBJECT, expected: [] }),
    JSON.stringify({ id: SUBJECT, expected: "  " }),
    JSON.stringify({ id: SUBJECT, expected: null })
  ]) {
    const runGit = makeGit({ trees: { [`int1:${RECORD_IN_TREE}`]: rec } }, []);
    expectCode(
      () =>
        assertExpectedEnvelopePresent({
          runGit,
          mainRepo: MAIN_REPO,
          baseSha: "int1",
          subject: SUBJECT
        }),
      CODES.EXPECTED_ENVELOPE_MISSING,
      `record ${rec} must be treated as missing`
    );
  }
});

test("(a) `#slice` subject checks the slice's `expected`", () => {
  const rec = JSON.stringify({
    id: SUBJECT,
    expected: { envelope: "record-level" },
    slices: [{ id: "SLICE-001", expected: { envelope: "slice-level" } }]
  });
  const runGit = makeGit({ trees: { [`int1:${RECORD_IN_TREE}`]: rec } }, []);
  const result = assertExpectedEnvelopePresent({
    runGit,
    mainRepo: MAIN_REPO,
    baseSha: "int1",
    subject: `${SUBJECT}#SLICE-001`
  });
  assert.equal(result.source, "slices[SLICE-001].expected");
  assert.equal(result.present, true);
});

test("(a) `#slice` subject falls back to the record-level `expected` when the slice lacks the field", () => {
  const rec = JSON.stringify({
    id: SUBJECT,
    expected: { envelope: "record-level" },
    slices: [{ id: "SLICE-001" }]
  });
  const runGit = makeGit({ trees: { [`int1:${RECORD_IN_TREE}`]: rec } }, []);
  const result = assertExpectedEnvelopePresent({
    runGit,
    mainRepo: MAIN_REPO,
    baseSha: "int1",
    subject: `${SUBJECT}#SLICE-001`
  });
  assert.equal(result.source, "expected");
  assert.equal(result.present, true);
});

test("(a) gate rejects an invalid subject and a non-absolute mainRepo", () => {
  const runGit = makeGit({}, []);
  expectCode(
    () => assertExpectedEnvelopePresent({ runGit, mainRepo: MAIN_REPO, baseSha: "int1", subject: "not-a-wk" }),
    CODES.INVALID_SUBJECT
  );
  expectCode(
    () => assertExpectedEnvelopePresent({ runGit, mainRepo: "relative/repo", baseSha: "int1", subject: SUBJECT }),
    CODES.INVALID_ARG
  );
  expectCode(
    () => assertExpectedEnvelopePresent({ runGit, mainRepo: MAIN_REPO, baseSha: "  ", subject: SUBJECT }),
    CODES.INVALID_ARG
  );
});

test("(b) WK_RECORD_UNREADABLE_IN_TREE when the record is missing from the tree", () => {
  const runGit = makeGit({ trees: {} }, []);
  expectCode(
    () => assertExpectedEnvelopePresent({ runGit, mainRepo: MAIN_REPO, baseSha: "int1", subject: SUBJECT }),
    CODES.WK_RECORD_UNREADABLE_IN_TREE
  );
});

test("(b) WK_RECORD_UNREADABLE_IN_TREE when the record in the tree is not valid JSON", () => {
  const runGit = makeGit({ trees: { [`int1:${RECORD_IN_TREE}`]: "{ not json" } }, []);
  expectCode(
    () => assertExpectedEnvelopePresent({ runGit, mainRepo: MAIN_REPO, baseSha: "int1", subject: SUBJECT }),
    CODES.WK_RECORD_UNREADABLE_IN_TREE
  );
});

test("(b) INTEGRATION_BRANCH_MISSING refuses first-attempt provisioning (no auto-create)", () => {
  const events = [];
  const runGit = makeGit({ branches: {} }, events);
  let allocated = false;
  expectCode(
    () =>
      provisionWorktreeAtDispatch({
        mainRepo: MAIN_REPO,
        initiative: INITIATIVE,
        subject: SUBJECT,
        launchRef: LAUNCH_REF,
        runId: RUN_ID,
        worktreeRoot: WORKTREE_ROOT,
        deps: {
          runGit,
          allocatePerWkWorktree: () => {
            allocated = true;
            return {};
          }
        }
      }),
    CODES.INTEGRATION_BRANCH_MISSING
  );
  assert.equal(allocated, false, "must refuse before allocating");
});

test("(b) INTEGRATION_BRANCH_UNBORN refuses when the integration branch has no resolvable commit", () => {
  const runGit = makeGit({ branches: { [INTEGRATION_REF]: null } }, []);
  expectCode(
    () =>
      provisionWorktreeAtDispatch({
        mainRepo: MAIN_REPO,
        initiative: INITIATIVE,
        subject: SUBJECT,
        launchRef: LAUNCH_REF,
        runId: RUN_ID,
        worktreeRoot: WORKTREE_ROOT,
        deps: { runGit, allocatePerWkWorktree: () => ({}) }
      }),
    CODES.INTEGRATION_BRANCH_UNBORN
  );
});

function firstAttemptDeps(spec, events, allocateOverride) {
  const runGit = makeGit(spec, events);
  const allocatePerWkWorktree =
    allocateOverride ??
    (() => {
      events.push("allocate");

      return {
        schema_version: "worktree-identity-binding.v1",
        output_branch: PER_WK_REF,
        worktree_path: `${WORKTREE_ROOT}/wk-${INITIATIVE}-${SUBJECT}`,
        write_scope: [`tests/${SUBJECT}.test.mjs`],
        base_ref: INTEGRATION_REF,
        base_sha: "int1"
      };
    });
  return { runGit, allocatePerWkWorktree, events };
}

test("(c) first-attempt happy path returns the frozen binding with the gate having run BEFORE allocation", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int1" },
    trees: { [`int1:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  const { runGit, allocatePerWkWorktree } = firstAttemptDeps(spec, events);
  const result = provisionWorktreeAtDispatch({
    mainRepo: MAIN_REPO,
    initiative: INITIATIVE,
    subject: SUBJECT,
    launchRef: LAUNCH_REF,
    runId: RUN_ID,
    worktreeRoot: WORKTREE_ROOT,
    deps: { runGit, allocatePerWkWorktree }
  });

  assert.ok(Object.isFrozen(result));
  assert.equal(result.schema_version, WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION);
  assert.equal(result.mode, "first-attempt");
  assert.equal(result.initiative, INITIATIVE);
  assert.equal(result.subject, SUBJECT);
  assert.equal(result.output_branch, PER_WK_REF);
  assert.equal(result.worktree_path, `${WORKTREE_ROOT}/wk-${INITIATIVE}-${SUBJECT}`);
  assert.deepEqual(result.write_scope, [`tests/${SUBJECT}.test.mjs`]);
  assert.ok(Object.isFrozen(result.write_scope));
  assert.equal(result.base_sha, "int1");
  assert.equal(result.base_ref, INTEGRATION_REF);
  assert.equal(result.expected_envelope_present, true);
  assert.equal(result.expected_envelope_field, "expected");
  assert.equal(result.isolation_invariant, WORKTREE_PROVISIONING_ISOLATION_INVARIANT);

  const showIdx = events.indexOf("git:show");
  const allocateIdx = events.indexOf("allocate");
  assert.ok(showIdx >= 0 && allocateIdx >= 0);
  assert.ok(showIdx < allocateIdx, `expected gate (show@${showIdx}) before allocate@${allocateIdx}`);
});

test("(c) first-attempt refuses EXPECTED_ENVELOPE_MISSING BEFORE allocating", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int1" },
    trees: { [`int1:${RECORD_IN_TREE}`]: JSON.stringify({ id: SUBJECT }) }
  };
  const runGit = makeGit(spec, events);
  expectCode(
    () =>
      provisionWorktreeAtDispatch({
        mainRepo: MAIN_REPO,
        initiative: INITIATIVE,
        subject: SUBJECT,
        launchRef: LAUNCH_REF,
        runId: RUN_ID,
        worktreeRoot: WORKTREE_ROOT,
        deps: {
          runGit,
          allocatePerWkWorktree: () => {
            events.push("allocate");
            return {};
          }
        }
      }),
    CODES.EXPECTED_ENVELOPE_MISSING
  );
  assert.ok(!events.includes("allocate"), "must not allocate when the gate refuses");
});

test("(c) first-attempt raises BASE_SHA_RACED when the tip moves between gate and mint", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int1" },
    trees: { [`int1:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  const runGit = makeGit(spec, events);

  const allocatePerWkWorktree = () => ({
    output_branch: PER_WK_REF,
    worktree_path: `${WORKTREE_ROOT}/wk-${INITIATIVE}-${SUBJECT}`,
    write_scope: [],
    base_ref: INTEGRATION_REF,
    base_sha: "int2"
  });
  expectCode(
    () =>
      provisionWorktreeAtDispatch({
        mainRepo: MAIN_REPO,
        initiative: INITIATIVE,
        subject: SUBJECT,
        launchRef: LAUNCH_REF,
        runId: RUN_ID,
        worktreeRoot: WORKTREE_ROOT,
        deps: { runGit, allocatePerWkWorktree }
      }),
    CODES.BASE_SHA_RACED
  );
});

test("(c) invalid retryId is refused with INVALID_ARG", () => {
  const runGit = makeGit({ branches: { [INTEGRATION_REF]: "int1" } }, []);
  expectCode(
    () =>
      provisionWorktreeAtDispatch({
        mainRepo: MAIN_REPO,
        initiative: INITIATIVE,
        subject: SUBJECT,
        launchRef: LAUNCH_REF,
        runId: RUN_ID,
        retryId: -1,
        worktreeRoot: WORKTREE_ROOT,
        deps: { runGit, allocatePerWkWorktree: () => ({}) }
      }),
    CODES.INVALID_ARG
  );
});

const EXISTING_BINDING = Object.freeze({
  output_branch: PER_WK_REF,
  worktree_path: `${WORKTREE_ROOT}/wk-${INITIATIVE}-${SUBJECT}`,
  write_scope: [`tests/${SUBJECT}.test.mjs`],
  base_ref: INTEGRATION_REF
});

function reProvisionCall(spec, events, overrides = {}) {
  const runGit = makeGit(spec, events);
  const resolveWorktreeBinding =
    overrides.resolveWorktreeBinding ??
    (() => {
      events.push("resolveBinding");
      return { ...EXISTING_BINDING };
    });
  const resetWorktreeToIntegrationTip =
    overrides.resetWorktreeToIntegrationTip ??
    ((args) => {
      events.push("reset");
      return {
        worktree_path: EXISTING_BINDING.worktree_path,
        integration_ref: INTEGRATION_REF,
        reset_to_sha: overrides.resetToSha ?? "int2",
        liveness: "dead"
      };
    });
  return provisionWorktreeAtDispatch({
    mainRepo: MAIN_REPO,
    initiative: INITIATIVE,
    subject: SUBJECT,
    launchRef: LAUNCH_REF,
    runId: RUN_ID,
    retryId: 1,
    priorIdentity: { pid: 4321, starttime: "111" },
    deps: { runGit, resolveWorktreeBinding, resetWorktreeToIntegrationTip }
  });
}

test("(d) re-provision resets to the integration tip and returns the re-provision binding", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int2", [PER_WK_REF]: "wktip" },
    ancestors: [["wktip", "int2"]],
    trees: { [`int2:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  const result = reProvisionCall(spec, events);

  assert.ok(Object.isFrozen(result));
  assert.equal(result.mode, "re-provision");
  assert.equal(result.base_sha, "int2");
  assert.equal(result.base_ref, INTEGRATION_REF);
  assert.equal(result.output_branch, PER_WK_REF);
  assert.deepEqual(result.write_scope, [`tests/${SUBJECT}.test.mjs`]);
  assert.equal(result.retry_id, 1);
  assert.equal(result.prior_wk_tip, "wktip");
  assert.equal(result.reset_to_sha, "int2");
  assert.equal(result.liveness, "dead");
  assert.equal(result.expected_envelope_present, true);
  assert.equal(result.isolation_invariant, WORKTREE_PROVISIONING_ISOLATION_INVARIANT);

  const showIdx = events.indexOf("git:show");
  const resetIdx = events.indexOf("reset");
  assert.ok(showIdx >= 0 && resetIdx >= 0 && showIdx < resetIdx, "gate must precede reset");
});

test("(d) re-provision refuses RE_PROVISION_NOT_FAST_FORWARD without gating or resetting", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int2", [PER_WK_REF]: "wktip" },
    ancestors: [],
    trees: { [`int2:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  expectCode(() => reProvisionCall(spec, events), CODES.RE_PROVISION_NOT_FAST_FORWARD);
  assert.ok(!events.includes("git:show"), "must refuse before the expected-presence gate");
  assert.ok(!events.includes("reset"), "must refuse before the destructive reset");
});

test("(d) re-provision RE-APPLIES the expected-presence gate per provision, before reset", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int2", [PER_WK_REF]: "wktip" },
    ancestors: [["wktip", "int2"]],
    trees: { [`int2:${RECORD_IN_TREE}`]: JSON.stringify({ id: SUBJECT }) }
  };
  expectCode(() => reProvisionCall(spec, events), CODES.EXPECTED_ENVELOPE_MISSING);
  assert.ok(!events.includes("reset"), "must not reset when the re-applied gate refuses");
});

test("(d) re-provision raises BASE_SHA_RACED when the reset lands off the gated base_sha", () => {
  const events = [];
  const spec = {
    branches: { [INTEGRATION_REF]: "int2", [PER_WK_REF]: "wktip" },
    ancestors: [["wktip", "int2"]],
    trees: { [`int2:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  expectCode(
    () => reProvisionCall(spec, events, { resetToSha: "int3" }),
    CODES.BASE_SHA_RACED
  );
});

test("(d) re-provision skips the fast-forward check when the per-WK ref has no tip yet", () => {
  const events = [];
  const spec = {

    branches: { [INTEGRATION_REF]: "int2" },
    trees: { [`int2:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  const result = reProvisionCall(spec, events);
  assert.equal(result.mode, "re-provision");
  assert.equal(result.base_sha, "int2");
  assert.equal(result.prior_wk_tip, null);
  assert.ok(!events.includes("git:merge-base"), "no ff check when there is no per-WK tip");
});

test("(d) re-provision forwards priorIdentity and the server-side runGit to the injected reset dep", () => {
  const events = [];
  let seenArgs = null;
  const spec = {
    branches: { [INTEGRATION_REF]: "int2", [PER_WK_REF]: "wktip" },
    ancestors: [["wktip", "int2"]],
    trees: { [`int2:${RECORD_IN_TREE}`]: recordWithExpected() }
  };
  reProvisionCall(spec, events, {
    resetWorktreeToIntegrationTip: (args) => {
      events.push("reset");
      seenArgs = args;
      return {
        worktree_path: EXISTING_BINDING.worktree_path,
        integration_ref: INTEGRATION_REF,
        reset_to_sha: "int2",
        liveness: "dead"
      };
    }
  });
  assert.ok(seenArgs, "reset dep must be invoked");
  assert.equal(seenArgs.mainRepo, MAIN_REPO);
  assert.equal(seenArgs.launchRef, LAUNCH_REF);
  assert.equal(seenArgs.runId, RUN_ID);
  assert.equal(seenArgs.retryId, 0, "reset resolves the retry_id=0 binding as the sole source of truth");
  assert.deepEqual(seenArgs.priorIdentity, { pid: 4321, starttime: "111" });
  assert.equal(typeof seenArgs.runGit, "function", "the server-side runGit must be threaded to the reset dep");
});
