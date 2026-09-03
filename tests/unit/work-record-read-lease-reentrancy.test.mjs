

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  withCanonicalWorkRecordReadLease,
  writeValidatedWorkRecord
} from "../../packages/wiki-core/src/operations/work-records-store-io.mjs";
import {
  createControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  controlledContractPackCarrierFilename,
  withCanonicalControlledContractSourceLease
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");

const FIXTURE_WK = "WK-2327";
const FORBIDDEN_PACK = Object.freeze({
  profileId: "proof.operation.forbidden-noninvocation",
  profileVersion: "2.0.0"
});
const FORBIDDEN_INTENT = "controlled-proof-intent.forbidden-operation-noninvocation";

const MAX_DURATION_MS = 60_000;

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk-read-lease-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work-records"), { recursive: true });
  const recordPath = path.join(root, "wiki", "work-records", `${FIXTURE_WK}.json`);
  await writeFile(recordPath, await readFile(
    path.join(REPO, "wiki", "work-records", `${FIXTURE_WK}.json`)));
  await writeFile(
    path.join(root, "wiki", "contracts", `${FIXTURE_WK}.controlled-acceptance.json`),
    await readFile(path.join(CONTRACTS, `${FIXTURE_WK}.controlled-acceptance.json`)));
  return { root, recordPath };
}

async function json(filename) {
  return JSON.parse(await readFile(path.join(CONTRACTS, filename), "utf8"));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("condition was never reached");
}

async function rejectionCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error?.code ?? null;
  }
  assert.fail("call should have refused");
}

test("a default read lease resolves the canonical record without an internal exception",
  async (t) => {
    const { root } = await fixture(t);

    const digest = await withCanonicalWorkRecordReadLease({ dir: root, id: FIXTURE_WK },
      async ({ record, source_digest: sourceDigest }) => {
        assert.equal(record.id, FIXTURE_WK);
        assert.equal(sourceDigest.startsWith("sha256:"), true);
        return sourceDigest;
      });
    assert.equal(digest.startsWith("sha256:"), true);
  });

test("the exact maximum duration is accepted and anything above it refuses typed",
  async (t) => {
    const { root } = await fixture(t);
    const accepted = await withCanonicalWorkRecordReadLease({
      dir: root, id: FIXTURE_WK, maximumDurationMs: MAX_DURATION_MS
    }, async ({ source_digest: sourceDigest }) => sourceDigest);
    assert.equal(accepted.startsWith("sha256:"), true);

    assert.equal(await rejectionCode(withCanonicalWorkRecordReadLease({
      dir: root,
      id: FIXTURE_WK,
      maximumDurationMs: MAX_DURATION_MS + 1
    }, async () => "unreachable")), "canonical_work_record_read_lease_input_invalid");

    assert.equal(await rejectionCode(withCanonicalControlledContractSourceLease({
      repoRoot: root,
      wkId: FIXTURE_WK,
      maximumDurationMs: MAX_DURATION_MS + 1
    }, async () => "unreachable")), "canonical_work_record_read_lease_input_invalid");
  });

test("a nested read lease in the same async context is admitted re-entrantly",
  async (t) => {
    const { root } = await fixture(t);
    const observed = await withCanonicalWorkRecordReadLease({ dir: root, id: FIXTURE_WK },
      async ({ source_digest: outerDigest }) => {

        const started = Date.now();
        const innerDigest = await withCanonicalWorkRecordReadLease(
          { dir: root, id: FIXTURE_WK },
          async ({ source_digest: digest }) => digest);
        return { outerDigest, innerDigest, elapsedMs: Date.now() - started };
      });
    assert.equal(observed.innerDigest, observed.outerDigest);
    assert.equal(observed.elapsedMs < 1000, true,
      `nested lease took ${observed.elapsedMs}ms, which is lock contention rather than re-entry`);
  });

test("an independent async context still serializes behind a live read lease",
  async (t) => {
    const { root } = await fixture(t);
    const events = [];
    let releaseOuter;
    const outerGate = new Promise((resolve) => { releaseOuter = resolve; });

    const outer = withCanonicalWorkRecordReadLease({ dir: root, id: FIXTURE_WK }, async () => {
      events.push("outer:enter");
      await outerGate;
      events.push("outer:exit");
    });
    await waitFor(() => events.includes("outer:enter"));

    const independent = withCanonicalWorkRecordReadLease({ dir: root, id: FIXTURE_WK },
      async () => { events.push("independent:enter"); });
    await delay(400);
    assert.equal(events.includes("independent:enter"), false,
      "re-entry leaked to a context that does not hold the lock");

    releaseOuter();
    await outer;
    await independent;
    assert.deepEqual(events, ["outer:enter", "outer:exit", "independent:enter"]);
  });

test("a canonical work-record write inside a live read lease is refused and changes no bytes",
  { timeout: 60_000 }, async (t) => {
    const { root, recordPath } = await fixture(t);
    const before = await readFile(recordPath, "utf8");

    const result = await withCanonicalWorkRecordReadLease({ dir: root, id: FIXTURE_WK },
      async ({ record, source_digest: sourceDigest }) => {

        return writeValidatedWorkRecord({
          dir: root,
          record: { ...structuredClone(record), title: `${record.title} (mutated)` },
          expectedSourceDigest: sourceDigest
        });
      });

    assert.equal(result.written, false);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), ["work_record_write_failed"]);
    assert.equal(await readFile(recordPath, "utf8"), before);
  });

test("the real carrier operations drive the read lease end to end", async (t) => {
  const { root } = await fixture(t);
  const packFilename = controlledContractPackCarrierFilename({
    wkId: FIXTURE_WK, ...FORBIDDEN_PACK
  });

  const created = await createControlledContractCarrierOperation({
    repoRoot: root,
    wkId: FIXTURE_WK,
    focus: null,
    carrierKind: "evaluation_input",
    profileId: FORBIDDEN_PACK.profileId,
    profileVersion: FORBIDDEN_PACK.profileVersion,
    expectedContentDigest: null,
    content: await json(packFilename)
  });
  assert.equal(created.content_digest.startsWith("sha256:"), true);

  await createControlledContractCarrierOperation({
    repoRoot: root,
    wkId: FIXTURE_WK,
    carrierKind: "proof_plan_request",
    expectedContentDigest: null,
    content: {
      schema_version: "controlled-contract-proof-plan-request.v1",
      requested_intents: [FORBIDDEN_INTENT],
      selected_packs: [{
        profile_id: FORBIDDEN_PACK.profileId,
        profile_version: FORBIDDEN_PACK.profileVersion
      }]
    }
  });

  const leased = await withCanonicalControlledContractSourceLease({
    repoRoot: root,
    wkId: FIXTURE_WK,
    maximumDurationMs: MAX_DURATION_MS
  }, async ({ record, source_digests: sourceDigests }) => {
    assert.equal(record.id, FIXTURE_WK);
    return sourceDigests;
  });

  assert.equal(leased["work-record"].startsWith("sha256:"), true);
  assert.equal(leased[packFilename], created.content_digest);
});
