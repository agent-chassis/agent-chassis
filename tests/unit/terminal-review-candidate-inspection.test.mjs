import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
  TERMINAL_WK_CANDIDATE_CODES,
  observeExactDirectCommitRef,
  readExactWkRecordBlobObservation,
  inspectTerminalReviewCandidateAuthority,
  projectTerminalWkCandidateFailure,
  TerminalWkCandidateError
} from "../../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  projectAuthenticatedControlledContractGeneration
} from "../../packages/wiki-core/src/lib/controlled-contract-generation-authentication.mjs";
import { authenticatedGenerationFixture } from "../controlled-contract-authentication-fixture.mjs";

const OID = "a".repeat(40);
const WK = "b".repeat(40);
const BLOB = "c".repeat(40);
const repo = "/fixture/repo";

const CURRENT_W = "a".repeat(40);

function generationOf(wkTipSha = CURRENT_W) {
  return authenticatedGenerationFixture({ repository: repo, wkId: "WK-1234", wkTipSha });
}

function generationMetadataLines(generation, { generationDigest = null } = {}) {
  const projected = projectAuthenticatedControlledContractGeneration(generation);
  return [
    `Generation-Digest: ${generationDigest ?? projected.generation_digest}`,
    `Generation-Count: ${projected.count}`,
    `Manifest-Identity: ${projected.manifest_identity}`,
    ...projected.descriptors.map(({ path, content_digest }) => `Carrier: ${path} ${content_digest}`)
  ];
}

function runner(result) {
  const calls = [];
  const runGit = ({ args }) => {
    calls.push(args);
    return typeof result === "function" ? result(args) : result;
  };
  return { calls, runGit };
}

test("exact direct ref accepts one canonical direct commit and preserves argument authority", async () => {
  const { calls, runGit } = runner({ ok: true, stdout: `refs/x\0${OID}\0commit\0\n` });
  assert.equal(await observeExactDirectCommitRef({ mainRepo: repo, ref: "refs/x", runGit, subject: "fixture" }), OID);
  assert.deepEqual(calls[0], ["--no-replace-objects", "for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)", "--count=2", "--", "refs/x"]);
});

for (const [name, stdout] of [
  ["symbolic", `refs/x\0${OID}\0commit\0refs/heads/main\n`],
  ["wrong object", `refs/x\0${OID}\0tree\0\n`],
  ["malformed", `refs/x\0${OID}\0commit\0`],
  ["ambiguous", `refs/x\0${OID}\0commit\0\nrefs/x\0${OID}\0commit\0\n`]
]) {
  test(`exact direct ref refuses ${name}`, async () => {
    const { runGit } = runner({ ok: true, stdout });
    await assert.rejects(observeExactDirectCommitRef({ mainRepo: repo, ref: "refs/x", runGit, subject: "fixture" }), { code: "agent_launch.terminal_wk_candidate.binding_mismatch.v1" });
  });
}

test("exact direct ref distinguishes absence and Git failure", async () => {
  const absent = runner({ ok: true, stdout: "" });
  assert.equal(await observeExactDirectCommitRef({ mainRepo: repo, ref: "refs/x", runGit: absent.runGit, subject: "fixture" }), null);
  const failed = runner({ ok: false, status: 128, stderr: "missing" });
  await assert.rejects(observeExactDirectCommitRef({ mainRepo: repo, ref: "refs/x", runGit: failed.runGit, subject: "fixture" }), { code: "agent_launch.terminal_wk_candidate.git_failed.v1" });
});

test("successful direct-ref and record observations ignore benign stderr", async () => {
  const direct = runner({ ok: true, status: 0, stderr: "warning: unrelated diagnostic", stdout: `refs/x\0${OID}\0commit\0\n` });
  assert.equal(await observeExactDirectCommitRef({ mainRepo: repo, ref: "refs/x", runGit: direct.runGit, subject: "fixture" }), OID);
  const record = runner((args) => args[1] === "ls-tree"
    ? { ok: true, status: 0, stderr: "warning", stdout: `100644 blob ${BLOB}\twiki/work-records/WK-1234.json\0` }
    : { ok: true, status: 0, stderr: "warning", stdout: "{}" });
  assert.equal((await readExactWkRecordBlobObservation({ mainRepo: repo, wkTip: WK, canonicalWkId: "WK-1234", objectFormat: "sha1", runGit: record.runGit })).state, "present");
});

test("record observation validates blob width against the resolved object format", async () => {
  const sha256Blob = "d".repeat(64);
  const { runGit } = runner((args) => args[1] === "ls-tree"
    ? { ok: true, stdout: `100644 blob ${sha256Blob}\twiki/work-records/WK-1234.json\0` }
    : { ok: true, stdout: "{}" });
  await assert.rejects(readExactWkRecordBlobObservation({
    mainRepo: repo, wkTip: WK, canonicalWkId: "WK-1234", objectFormat: "sha1", runGit
  }), { code: TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID });
});

test("record observation reads the exact path then exact blob OID", async () => {
  const { calls, runGit } = runner((args) => args[1] === "ls-tree"
    ? { ok: true, stdout: `100644 blob ${BLOB}\t wiki/work-records/WK-1234.json\0`.replace("\t wiki", "\twiki") }
    : { ok: true, stdout: "{\"id\":\"WK-1234\"}" });
  const observed = await readExactWkRecordBlobObservation({ mainRepo: repo, wkTip: WK, canonicalWkId: "WK-1234", objectFormat: "sha1", runGit });
  assert.equal(observed.state, "present");
  assert.equal(observed.oid, BLOB);
  assert.deepEqual(calls.map((args) => args.slice(1)), [
    ["ls-tree", "-z", "--full-tree", WK, "--", "wiki/work-records/WK-1234.json"],
    ["cat-file", "blob", BLOB]
  ]);
});

test("record observation treats only zero ls-tree entries as absence", async () => {
  const { runGit } = runner({ ok: true, stdout: "" });
  assert.deepEqual(await readExactWkRecordBlobObservation({ mainRepo: repo, wkTip: WK, canonicalWkId: "WK-1234", objectFormat: "sha1", runGit }), {
    state: "absent", path: "wiki/work-records/WK-1234.json", wk_tip: WK
  });
  const malformed = runner({ ok: true, stdout: "not-an-entry\0" });
  await assert.rejects(readExactWkRecordBlobObservation({ mainRepo: repo, wkTip: WK, canonicalWkId: "WK-1234", objectFormat: "sha1", runGit: malformed.runGit }), { code: "agent_launch.terminal_wk_candidate.candidate_invalid.v1" });
});

test("fixture constants retain the candidate schema contract for later v2/v3 builders", () => {
  assert.equal(TERMINAL_WK_CANDIDATE_SCHEMA_VERSION, "agent_launch.terminal_wk_candidate.v2");
  assert.match(WK, /^[0-9a-f]{40}$/u);
});

export function buildV2Fixture(overrides = {}) {
  return { mainRepo: repo, initiative: "IN-0016", canonicalWkId: "WK-1234", ...overrides };
}

export function buildV3Fixture(overrides = {}) {
  return buildV2Fixture(overrides);
}

test("primary inspector is directly invoked and reports a computed moved-W fact", async () => {
  const candidate = "d".repeat(40);
  const generation = await generationOf();
  const repositoryDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    root: repo, common_dir: repo, object_format: "sha1"
  })).digest("hex")}`;
  const metadata = [
    "WK-1234: terminal squash candidate", "", `Base: ${"e".repeat(40)}`,
    `WK: ${WK}`, `Repository: ${repositoryDigest}`,
    `Contract: sha256:${"0".repeat(64)}`,
    ...generationMetadataLines(generation), ""
  ].join("\n");
  const values = buildV2Fixture();
  const { runGit } = runner((args) => {
    if (args[1] === "rev-parse" && args[2] === "--path-format=absolute") return { ok: true, stdout: `${repo}\n` };
    if (args[1] === "rev-parse" && args[2] === "--show-object-format") return { ok: true, stdout: "sha1\n" };
    if (args[1] === "for-each-ref") {
      const ref = args.at(-1); const oid = ref.includes("terminal-current") ? candidate : ref.includes("wk-forks") ? "e".repeat(40) : CURRENT_W;
      return { ok: true, stdout: `${ref}\0${oid}\0commit\0\n` };
    }
    if (args[1] === "cat-file" && args[2] === "commit") return { ok: true, stdout: metadata };
    if (args[1] === "rev-parse") {
      const object = args[2];
      const tree = object === `${candidate}^{tree}` || object === `${WK}^{tree}` ? "1".repeat(40) : "3".repeat(40);
      return { ok: true, stdout: `${tree}\n` };
    }
    if (args[1] === "rev-list") return { ok: true, stdout: `${candidate} ${"e".repeat(40)}\n` };
    if (args[1] === "merge-base") return { ok: true, status: 0, stdout: "" };
    throw new Error(`unexpected ${args.join(" ")}`);
  });
  const result = await inspectTerminalReviewCandidateAuthority({
    ...values, generationAuthentication: generation, runGit
  });
  assert.equal(result.embedded_w_equal_current_w, false);
  assert.deepEqual(result.invariant_causes, []);
  assert.deepEqual(result.movement_causes, ["w_moved"]);
  assert.equal(result.current_w_tree_equal_embedded_w_tree, false);
});

test("durable-ref absence is incomplete and does not fabricate invariant facts", async () => {
  const candidate = "d".repeat(40);
  const generation = await generationOf();
  const values = buildV2Fixture();
  const { runGit } = runner((args) => {
    if (args[1] === "rev-parse" && args[2] === "--path-format=absolute") return { ok: true, stdout: `${repo}\n` };
    if (args[1] === "rev-parse" && args[2] === "--show-object-format") return { ok: true, stdout: "sha1\n" };
    if (args[1] === "for-each-ref") {
      const ref = args.at(-1);
      if (ref.includes("terminal-current")) return { ok: true, stdout: `${ref}\0${candidate}\0commit\0\n` };
      return { ok: true, stdout: "" };
    }
    if (args[1] === "cat-file" && args[2] === "commit") return { ok: true, stdout: [
      "WK-1234: terminal squash candidate", "", `Base: ${"e".repeat(40)}`,
      `WK: ${WK}`, `Repository: sha256:${"f".repeat(64)}`,
      `Contract: sha256:${"0".repeat(64)}`,
      ...generationMetadataLines(generation), ""
    ].join("\n") };
    throw new Error(`unexpected ${args.join(" ")}`);
  });
  const result = await inspectTerminalReviewCandidateAuthority({
    ...values, generationAuthentication: generation, runGit
  });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.direct_ref_availability, { candidate: true, fork: false, wk: false });
  assert.deepEqual(result.absence_causes, ["fork_ref_absent", "wk_ref_absent"]);
  assert.equal("invariant_causes" in result, false);
  assert.equal("embedded_w_equal_current_w" in result, false);
});

async function inspectionFixture({ fork = "e".repeat(40), wk = CURRENT_W, candidateTree = "2".repeat(40), mergeBase = { ok: true, status: 0, stdout: "" }, forkPresent = true, wkPresent = true, metadataGenerationDigest = null } = {}) {
  const candidate = "d".repeat(40);
  const base = "e".repeat(40);
  const generation = await generationOf(wk);
  const repositoryDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    root: repo, common_dir: repo, object_format: "sha1"
  })).digest("hex")}`;
  const metadata = [
    "WK-1234: terminal squash candidate", "", `Base: ${base}`,
    `WK: ${WK}`, `Repository: ${repositoryDigest}`,
    `Contract: sha256:${"0".repeat(64)}`,
    ...generationMetadataLines(generation, { generationDigest: metadataGenerationDigest }), ""
  ].join("\n");
  const values = buildV2Fixture();
  const { calls, runGit } = runner((args) => {
    if (args[1] === "rev-parse" && args[2] === "--path-format=absolute") return { ok: true, stdout: `${repo}\n` };
    if (args[1] === "rev-parse" && args[2] === "--show-object-format") return { ok: true, stdout: "sha1\n" };
    if (args[1] === "for-each-ref") {
      const ref = args.at(-1);
      if (ref.includes("terminal-current")) return { ok: true, stdout: `${ref}\0${candidate}\0commit\0\n` };
      if (ref.includes("wk-forks")) return forkPresent
        ? { ok: true, stdout: `${ref}\0${fork}\0commit\0\n` } : { ok: true, stdout: "" };
      return wkPresent ? { ok: true, stdout: `${ref}\0${wk}\0commit\0\n` } : { ok: true, stdout: "" };
    }
    if (args[1] === "cat-file" && args[2] === "commit") return { ok: true, stdout: metadata };
    if (args[1] === "rev-parse") {
      const object = args[2];
      const tree = object === `${candidate}^{tree}` ? candidateTree
        : object === `${WK}^{tree}` ? "2".repeat(40) : "3".repeat(40);
      return { ok: true, stdout: `${tree}\n` };
    }
    if (args[1] === "rev-list") return { ok: true, stdout: `${candidate} ${base}\n` };
    if (args[1] === "merge-base") return mergeBase;
    throw new Error(`unexpected ${args.join(" ")}`);
  });
  return { values, calls, runGit, generation };
}

test("merge-base status 128 is projected with the logical operation and exact status", async () => {
  const { values, runGit, generation } = await inspectionFixture({ mergeBase: { ok: false, status: 128, stderr: "not ancestry" } });
  let error;
  try {
    await inspectTerminalReviewCandidateAuthority({ ...values, generationAuthentication: generation, runGit });
  } catch (caught) {
    error = caught;
  }
  const projected = projectTerminalWkCandidateFailure(error);
  assert.equal(projected.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED);

  assert.deepEqual(projected.detail, {
    git_args: ["--no-replace-objects", "merge-base", "--is-ancestor", "e".repeat(40), CURRENT_W],
    git_operation: "merge-base",
    git_status: 128,
    git_signal: null,
    git_stderr_bytes: Buffer.byteLength("not ancestry")
  });
  assert.equal(error.detail.stderr, "not ancestry");
  assert.equal(Object.hasOwn(projected.detail, "git_native_error"), false,
    "a Git exit with no spawn error names no native error");
});

test("exit 1 is a negative relationship only when Git reported no error for the comparison", async () => {
  const inspect = async (mergeBase) => {
    const { values, runGit, generation } = await inspectionFixture({ mergeBase });
    try {
      return { observed: await inspectTerminalReviewCandidateAuthority({
        ...values, generationAuthentication: generation, runGit }) };
    } catch (error) {
      return { error };
    }
  };
  const negative = await inspect({ ok: false, status: 1, signal: null, stdout: "", stderr: "",
    trace2: { state: "none_emitted", diagnostics: [] } });
  assert.equal(negative.error, undefined);
  assert.equal(negative.observed.base_ancestor_current_w, false);
  assert.equal(negative.observed.invariant_causes.includes("non_ancestor"), true);

  const uncaptured = await inspect({ ok: false, status: 1, signal: null, stdout: "", stderr: "" });
  assert.equal(uncaptured.observed.base_ancestor_current_w, false);
  const ancestor = await inspect({ ok: true, status: 0, stdout: "",
    trace2: { state: "captured", diagnostics: [{ msg: "a warning", fmt: "a warning" }] } });
  assert.equal(ancestor.observed.base_ancestor_current_w, true, "a warning never fails a success");

  const unreadable = { msg: `Could not read ${"9".repeat(40)}`, fmt: "Could not read %s" };
  for (const trace2 of [
    { state: "captured", diagnostics: [unreadable] },
    { state: "unavailable", diagnostics: [] },
    { state: "malformed", diagnostics: [] },
    { state: "overflow", diagnostics: [] }
  ]) {
    const failed = await inspect({ ok: false, status: 1, signal: null, stdout: "",
      stderr: `error: ${unreadable.msg}\n`, trace2 });
    assert.equal(failed.observed, undefined, `${trace2.state} became a negative relationship`);
    const { error } = failed;
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, trace2.state);
    assert.equal(error.message,
      "terminal WK candidate: could not complete the ancestry comparison of embedded B and current W");
    assert.equal(error.detail.status, 1);
    assert.equal(error.detail.base, "e".repeat(40));
    assert.equal(error.detail.wk_tip, CURRENT_W);
    const projected = projectTerminalWkCandidateFailure(error);
    assert.equal(projected.detail.git_operation, "merge-base");
    assert.equal(projected.detail.git_status, 1);
  }
});

test("a spawn failure keeps its native code, syscall, path and nested cause", async () => {
  const spawnError = Object.assign(new Error("spawn git ENOENT"), {
    code: "ENOENT", errno: -2, syscall: "spawn git", path: "git" });
  const { values, runGit, generation } = await inspectionFixture({
    mergeBase: { ok: false, status: null, signal: null, error: spawnError } });
  let error;
  try {
    await inspectTerminalReviewCandidateAuthority({ ...values, generationAuthentication: generation, runGit });
  } catch (caught) {
    error = caught;
  }
  const projected = projectTerminalWkCandidateFailure(error);
  assert.equal(projected.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED);
  assert.deepEqual(projected.detail, {
    git_args: ["--no-replace-objects", "merge-base", "--is-ancestor", "e".repeat(40), CURRENT_W],
    git_operation: "merge-base",
    git_status: null,
    git_signal: null,
    git_native_error: { code: "ENOENT", errno: -2, syscall: "spawn git", path: "git" }
  });

  assert.equal(error.cause, spawnError);
  assert.equal(error.detail.stderr, null);
});

for (const [name, options, expected] of [
  ["fork absent while WK present", { forkPresent: false }, ["fork_ref_absent"]],
  ["WK absent while fork present", { wkPresent: false }, ["wk_ref_absent"]]
]) {
  test(name, async () => {
    const { values, runGit, generation } = await inspectionFixture(options);
    const result = await inspectTerminalReviewCandidateAuthority({
      ...values, generationAuthentication: generation, runGit
    });
    assert.equal(result.state, "incomplete");
    assert.deepEqual(result.absence_causes, expected);
    assert.equal("invariant_causes" in result, false);
  });
}

test("content-changing W movement has empty invariant causes", async () => {
  const { values, runGit, generation } = await inspectionFixture();
  const result = await inspectTerminalReviewCandidateAuthority({
    ...values, generationAuthentication: generation, runGit
  });
  assert.deepEqual(result.movement_causes, ["w_moved"]);
  assert.deepEqual(result.invariant_causes, []);
  assert.equal(result.embedded_w_equal_current_w, false);
  assert.equal(result.current_w_tree_equal_embedded_w_tree, false);
});

test("inspection refuses an absent exact-W controlled generation identity", async () => {
  const { values, runGit } = await inspectionFixture();
  await assert.rejects(
    inspectTerminalReviewCandidateAuthority({ ...values, generationAuthentication: null, runGit }),
    { code: TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH });
});

test("inspection refuses a caller-authored generation identity lookalike", async () => {
  const { values, runGit, generation } = await inspectionFixture();

  const forged = JSON.parse(JSON.stringify(generation));
  await assert.rejects(
    inspectTerminalReviewCandidateAuthority({ ...values, generationAuthentication: forged, runGit }),
    { code: TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH });
});

test("inspection refuses an authenticated generation bound to a different W", async () => {
  const { values, runGit } = await inspectionFixture();
  const otherW = await generationOf("f".repeat(40));
  let error;
  try {
    await inspectTerminalReviewCandidateAuthority({ ...values, generationAuthentication: otherW, runGit });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof TerminalWkCandidateError);
  assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
  const projected = projectTerminalWkCandidateFailure(error);
  assert.equal(projected.kind, "typed_candidate_error");
  assert.equal(projected.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
});

test("candidate metadata bound to a superseded generation is a computed invariant cause", async () => {
  const movedDigest = `sha256:${"1".repeat(64)}`;
  const { values, runGit, generation } = await inspectionFixture({
    metadataGenerationDigest: movedDigest
  });
  const result = await inspectTerminalReviewCandidateAuthority({
    ...values, generationAuthentication: generation, runGit
  });
  assert.equal(result.state, "observed");
  assert.equal(result.generation_identity_equal, false);
  assert.deepEqual(result.invariant_causes, ["generation_identity_mismatch"]);
  assert.equal(result.generation_identity.generation_digest, movedDigest);
  assert.equal(result.current_generation_identity.generation_digest, generation.generation_digest);
  assert.notEqual(result.current_generation_identity.generation_digest, movedDigest);
});

test("content-changing W movement retains a genuine candidate invariant failure", async () => {
  const { values, runGit, generation } = await inspectionFixture({ candidateTree: "9".repeat(40) });
  const result = await inspectTerminalReviewCandidateAuthority({
    ...values, generationAuthentication: generation, runGit
  });
  assert.deepEqual(result.movement_causes, ["w_moved"]);
  assert.deepEqual(result.invariant_causes, ["candidate_tree_mismatch"]);
  assert.equal(result.current_w_tree_equal_embedded_w_tree, false);
});
