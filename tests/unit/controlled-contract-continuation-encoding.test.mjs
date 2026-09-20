import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_CONTINUATION_BUDGET,
  CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES,
  CONTROLLED_CONTRACT_CONTINUATION_PROJECTION_CAPACITY,
  continuationContentDigest,
  continuationIdentityBytes,
  continuationStorageBytes
} from "../../packages/wiki-core/src/lib/controlled-contract-continuation-encoding.mjs";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES
} from "../../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import {
  clearControlledContractAuthoringContinuationsForTest,
  getControlledContractAuthoringContinuation,
  getControlledContractRefactorContinuation,
  rememberControlledContractAuthoringContinuation,
  rememberControlledContractRefactorContinuation,
  updateControlledContractRefactorContinuation
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-continuations.mjs";

const SHA = (character) => `sha256:${character.repeat(64)}`;
const STORE = path.join(".agent-runs", "controlled-contract-authoring-continuations", "v1");

function historicalIdentityBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function historicalIdentityOf(record) {
  const body = structuredClone(record);
  delete body.identity;
  return `sha256:${createHash("sha256")
    .update(historicalIdentityBytes(body)).digest("hex")}`;
}

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "continuation-encoding-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  t.after(async () => {
    await clearControlledContractAuthoringContinuationsForTest({ repoRoot });
    await rm(repoRoot, { recursive: true, force: true });
  });
  return repoRoot;
}

function refactorInput(repoRoot, overrides = {}) {
  return {
    repoRoot,
    wkId: "WK-2504",
    focus: null,
    contractContentDigest: SHA("a"),
    packageGeneration: "1.0.0",
    source: { kind: "canonical", generation: "a".repeat(64) },
    planIdentity: SHA("b"),
    snapshotDigest: SHA("c"),
    transactionIdentity: SHA("d"),
    ...overrides
  };
}

function storedPath(repoRoot, identity) {
  return path.join(repoRoot, STORE, `${identity.slice("sha256:".length)}.json`);
}

function largeWorkbench(payloadBytes) {
  return {
    row_id: "contract_assessment:row-one",
    row_digest: SHA("2"),
    source_identity: { wk_id: "WK-2504" },
    dependencies: [],
    semantic_owner: "contract_carrier",
    response_kinds: ["contract_requirements"],
    owner_context: {
      expected_content_digest: SHA("a"),

      rows: Array.from({ length: Math.ceil(payloadBytes / 64) }, (_, index) => [
        `criterion-${index}`, `statement-${index}`, `locator-${index}`
      ])
    }
  };
}

test("identity bytes are the historical pretty form and storage bytes are compact",
  () => {
    const value = { b: [1, 2, { c: "x" }], a: "y" };
    assert.deepEqual(continuationIdentityBytes(value), historicalIdentityBytes(value));
    assert.equal(continuationStorageBytes(value).toString("utf8"),
      `${JSON.stringify(value)}\n`);
    assert.ok(continuationStorageBytes(value).byteLength <
      continuationIdentityBytes(value).byteLength);
    assert.equal(continuationContentDigest(value),
      `sha256:${createHash("sha256").update(historicalIdentityBytes(value))
        .digest("hex")}`);
  });

test("the continuation budget is derived from the per-carrier ceiling", () => {
  assert.equal(CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES,
    CONTROLLED_CONTRACT_CONTINUATION_PROJECTION_CAPACITY *
      CONTROLLED_CONTRACT_MAX_JSON_BYTES);
  assert.equal(CONTROLLED_CONTRACT_CONTINUATION_BUDGET.measurement,
    "compact_utf8_bytes");
  assert.equal(CONTROLLED_CONTRACT_CONTINUATION_BUDGET.per_projection_bytes,
    CONTROLLED_CONTRACT_MAX_JSON_BYTES);
});

test("identity is invariant to the on-disk encoding of the same value", () => {
  const value = { wk: "WK-2504", rows: [{ id: "one" }, { id: "two" }] };
  const fromPretty = JSON.parse(`${JSON.stringify(value, null, 2)}\n`);
  const fromCompact = JSON.parse(JSON.stringify(value));
  assert.equal(continuationContentDigest(fromPretty),
    continuationContentDigest(fromCompact));
  assert.equal(continuationContentDigest(fromPretty),
    continuationContentDigest(value));
});

test("a stored continuation is written compactly and reads back unchanged",
  async (t) => {
    const repoRoot = await fixture(t);
    const stored = await rememberControlledContractRefactorContinuation(
      refactorInput(repoRoot));
    const raw = await readFile(storedPath(repoRoot, stored.identity), "utf8");

    assert.ok(!raw.includes("\n  "), "stored continuation must not be pretty-printed");
    assert.equal(raw, `${JSON.stringify(JSON.parse(raw))}\n`);
    assert.ok(raw.length < historicalIdentityBytes(JSON.parse(raw)).byteLength);

    const reread = await getControlledContractRefactorContinuation({
      repoRoot, identity: stored.identity
    });
    assert.equal(reread.identity, stored.identity);
    assert.equal(reread.identity, historicalIdentityOf(reread));
  });

test("a continuation stored in the historical pretty form still authenticates",
  async (t) => {
    const repoRoot = await fixture(t);
    const stored = await rememberControlledContractRefactorContinuation(
      refactorInput(repoRoot));
    const filename = storedPath(repoRoot, stored.identity);

    const parsed = JSON.parse(await readFile(filename, "utf8"));
    await writeFile(filename, historicalIdentityBytes(parsed));

    const reread = await getControlledContractRefactorContinuation({
      repoRoot, identity: stored.identity
    });
    assert.equal(reread.identity, stored.identity);
    assert.deepEqual(structuredClone(reread), structuredClone(stored));
  });

test("a large continuation past the per-carrier ceiling is stored and re-read",
  async (t) => {
    const repoRoot = await fixture(t);
    const workbench = largeWorkbench(CONTROLLED_CONTRACT_MAX_JSON_BYTES);
    const stored = await rememberControlledContractAuthoringContinuation({
      repoRoot, wkId: "WK-2504", focus: null, contract: null, skeleton: null,
      workbench
    });

    const body = structuredClone(stored);
    delete body.identity;
    const identityBytes = continuationIdentityBytes(body).byteLength;
    const storedBytes = (await readFile(storedPath(repoRoot, stored.identity))).byteLength;

    assert.ok(identityBytes > CONTROLLED_CONTRACT_MAX_JSON_BYTES,
      `identity input ${identityBytes} must exceed the per-carrier ceiling`);
    assert.ok(storedBytes < CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES);

    const reread = await getControlledContractRefactorContinuation({
      repoRoot, identity: stored.identity
    });
    assert.equal(reread, null, "a workbench record is not a refactor record");
    assert.equal(stored.identity, historicalIdentityOf(stored));

    assert.equal(stored.workbench.semantic_owner, "contract_carrier");
    assert.deepEqual(stored.workbench.response_kinds, ["contract_requirements"]);
    assert.deepEqual(stored.workbench.owner_context, workbench.owner_context);
    const authenticated = await getControlledContractAuthoringContinuation({
      repoRoot, identity: stored.identity
    });
    assert.deepEqual(structuredClone(authenticated), structuredClone(stored));

    const filename = storedPath(repoRoot, stored.identity);
    const parsed = JSON.parse(await readFile(filename, "utf8"));
    parsed.workbench.owner_context.rows[0][0] = "criterion-changed";
    await writeFile(filename, `${JSON.stringify(parsed)}\n`);
    await assert.rejects(
      () => getControlledContractAuthoringContinuation({ repoRoot, identity: stored.identity }),
      (error) => {
        assert.equal(error.code, "controlled_contract_authoring_continuation_tampered");
        return true;
      });
  });

test("replaying the same transition returns the same target without a second write",
  async (t) => {
    const repoRoot = await fixture(t);
    const stored = await rememberControlledContractRefactorContinuation(
      refactorInput(repoRoot));

    const first = await updateControlledContractRefactorContinuation({
      repoRoot, wkId: "WK-2504", focus: null, identity: stored.identity,
      changes: { status: "publishing" }
    });
    const replay = await updateControlledContractRefactorContinuation({
      repoRoot, wkId: "WK-2504", focus: null, identity: stored.identity,
      changes: { status: "publishing" }
    });

    assert.equal(replay.identity, first.identity);
    assert.deepEqual(structuredClone(replay), structuredClone(first));
    assert.equal(first.identity, historicalIdentityOf(first));

    const resumed = await getControlledContractRefactorContinuation({
      repoRoot, identity: stored.identity
    });
    assert.equal(resumed.identity, first.identity);
    assert.equal(resumed.refactor.status, "publishing");
  });

test("a re-encoded record whose content changed is refused as tampered",
  async (t) => {
    const repoRoot = await fixture(t);
    const stored = await rememberControlledContractRefactorContinuation(
      refactorInput(repoRoot));
    const filename = storedPath(repoRoot, stored.identity);

    const parsed = JSON.parse(await readFile(filename, "utf8"));
    parsed.refactor.status = "published";
    await writeFile(filename, `${JSON.stringify(parsed)}\n`);

    await assert.rejects(
      () => getControlledContractRefactorContinuation({
        repoRoot, identity: stored.identity
      }),
      (error) => {
        assert.equal(error.code,
          "controlled_contract_authoring_continuation_tampered");
        return true;
      });
  });

test("compact re-encoding does not launder a mismatched stored identity",
  async (t) => {
    const repoRoot = await fixture(t);
    const stored = await rememberControlledContractRefactorContinuation(
      refactorInput(repoRoot));
    const filename = storedPath(repoRoot, stored.identity);

    const parsed = JSON.parse(await readFile(filename, "utf8"));
    parsed.package_generation = "9.9.9";
    await writeFile(filename, `${JSON.stringify(parsed)}\n`);

    await assert.rejects(
      () => getControlledContractRefactorContinuation({
        repoRoot, identity: stored.identity
      }),
      (error) => error.code ===
        "controlled_contract_authoring_continuation_tampered");
  });

test("a continuation over its budget refuses with the continuation code and budget",
  () => {
    const overBudget = {
      payload: "x".repeat(CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES + 1)
    };
    for (const encode of [continuationStorageBytes, continuationIdentityBytes]) {
      assert.throws(() => encode(overBudget), (error) => {
        assert.equal(error.code,
          "controlled_contract_authoring_continuation_too_large");
        assert.equal(error.details.maximum_bytes,
          CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES);
        assert.equal(error.details.measurement, "compact_utf8_bytes");
        assert.ok(error.details.byte_length >
          CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES);
        return true;
      });
    }
  });

test("the budget refuses on the stored unit, so storage and identity agree", () => {

  const value = { rows: Array.from({ length: 40_000 }, (_, index) => [index, index]) };
  const compact = continuationStorageBytes(value).byteLength;
  const pretty = continuationIdentityBytes(value).byteLength;
  assert.ok(compact < CONTROLLED_CONTRACT_CONTINUATION_MAX_BYTES);
  assert.ok(pretty > CONTROLLED_CONTRACT_MAX_JSON_BYTES);
  assert.ok(pretty > compact);
});
