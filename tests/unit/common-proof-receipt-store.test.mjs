import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMMON_PROOF_RECEIPT_DIRECTORY,
  COMMON_PROOF_RECEIPT_FAMILIES,
  COMMON_PROOF_RECEIPT_LIMITS,
  COMMON_PROOF_RECEIPT_REFUSAL_CODES as CODES,
  createCommonProofReceiptStore
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-common-proof-receipt-store.mjs";
import { materializeCommitObject } from
  "../../packages/agent-launch-cli/src/lib/commit-object-primitive.mjs";
import { verifyAndMeasureCommitScope } from
  "../../packages/agent-launch-cli/src/lib/commit-scope-envelope.mjs";
import {
  WRITE_CONFINEMENT_DELIVERY_INPUT_SCHEMA_VERSION,
  WRITE_CONFINEMENT_RECEIPT_BINDING_SCHEMA_VERSION
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-write-confinement-evidence.mjs";
import {
  BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES,
  buildBehavioralPreservationEvidencePair,
  buildBehavioralPreservationPublication
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-behavioral-preservation-evidence.mjs";
import {
  mintBehavioralPreservationPair
} from "../helpers/workspace-agent-behavioral-preservation-fixture.mjs";
import {
  resolveLauncherOwnedWorkspaceDurableStateRoot
} from "../../packages/agent-launch-core/src/lib/durable-runtime-state.mjs";

const BASE_SHA = "ba5e".padEnd(40, "0");
const TREE_OID = "77ee".padEnd(40, "0");
const COMMIT_OID = "c0b1".padEnd(40, "0");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, canonicalize(value[key])]));
}

function canonicalBytes(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function digest(value) {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

function digestBytesIdentity(bytes) {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function digestIdentity(value) {
  return digestBytesIdentity(canonicalBytes(value));
}

function resealRecord(record) {
  const event = record.events[0];
  record.selector_digest = digestIdentity(record.selector);
  event.selector_digest = record.selector_digest;
  event.projection_digest = digestBytesIdentity(event.projection_bytes);
  record.content_identity = event.projection_digest;
  const { event_digest: _eventDigest, ...eventBody } = event;
  event.event_digest = digestIdentity(eventBody);
  const { record_digest: _recordDigest, ...recordBody } = record;
  record.record_digest = digestIdentity(recordBody);
  return canonicalBytes(record);
}

async function plainRepository(t, prefix = "common-proof-store-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function pairedSetup(t) {
  const minted = await mintBehavioralPreservationPair(t);
  const repository = path.join(minted.root, "main");
  await mkdir(path.join(repository, ".git"));
  return { ...minted, repository,
    pair: buildBehavioralPreservationEvidencePair({
      baseline: minted.baseline, candidate: minted.candidate
    }) };
}

function fakeGit(raw = []) {
  return ({ args }) => {
    let index = 0;
    while (args[index] === "-c") index += 2;
    const command = args[index];
    const rest = args.slice(index + 1);
    if (command === "config") return { ok: true, stdout: "false\n" };
    if (["read-tree", "add"].includes(command)) return { ok: true, stdout: "" };
    if (command === "write-tree") return { ok: true, stdout: `${TREE_OID}\n` };
    if (command === "commit-tree") return { ok: true, stdout: `${COMMIT_OID}\n` };
    if (command === "diff-tree" && rest.includes("--raw")) {
      return { ok: true, stdout: `${raw.join("\n")}${raw.length > 0 ? "\n" : ""}` };
    }
    if (command === "diff-tree" && rest.includes("--numstat")) {
      return { ok: true, stdout: "" };
    }
    if (command === "ls-tree") return { ok: true, stdout: "" };
    throw new Error(`unexpected git command: ${args.join(" ")}`);
  };
}

function writePublication(repository, {
  observedAt = "2026-08-30T12:00:00.000Z",
  runId = "run-write-confinement"
} = {}) {
  const gitDir = path.join(repository, ".git");
  const materialized = materializeCommitObject({
    gitDir, workTree: repository, baseSha: BASE_SHA,
    message: "WK-2064#SLICE-006 common proof fixture",
    deps: { runGit: fakeGit() }
  });
  const scope = verifyAndMeasureCommitScope({
    gitDir, baseSha: materialized.base_sha, commit: materialized.commit,
    tree: materialized.tree, writeScope: ["src"],
    expectedEnvelope: { declared_metrics: { changed_line_count: 0 } },
    deps: { runGit: fakeGit(), resolveWriteScope: () => ({ matches: () => false }) }
  });
  const authenticatedDelivery = {
    schema_version: WRITE_CONFINEMENT_DELIVERY_INPUT_SCHEMA_VERSION,
    repository, run_id: runId, attempt: 1,
    record_id: "WK-2064", unit_address: "WK-2064#SLICE-006",
    selected_unit: { kind: "slice", address: "WK-2064#SLICE-006",
      record_id: "WK-2064", slice_id: "SLICE-006", repo: null },
    role: "worker", work_kind: "implementation", managed: true,
    run_status: "succeeded", write_scope: ["src"], materialized, scope
  };
  const receiptBinding = {
    schema_version: WRITE_CONFINEMENT_RECEIPT_BINDING_SCHEMA_VERSION,
    repository, run_id: authenticatedDelivery.run_id,
    attempt: authenticatedDelivery.attempt, record_id: authenticatedDelivery.record_id,
    unit_address: authenticatedDelivery.unit_address,
    base_commit: materialized.base_sha, delivery_commit: materialized.commit,
    source_digest: null, result_digest: null
  };
  return { authenticatedDelivery, receiptBinding, observedAt };
}

function behavioralReport(pair, position) {
  const binding = pair.pair_evidence.sides.find((side) => side.position === position);
  const report = {
    schema_version: "controlled-contract-behavioral-preservation-report.v1",
    observables: [{
      observable_id: "observable-test-result",
      observable_type: "return_value",
      canonical_value: "passed"
    }],
    observable_count: 1,
    selected_observable_id: "observable-test-result"
  };
  const reportBytes = JSON.stringify(report);
  return {
    evidence_id: binding.evidence_id,
    evidence_digest: binding.evidence_digest,
    relative_path: `reports/${position}.json`,
    report_bytes: reportBytes,
    report_digest: `sha256:${createHash("sha256").update(reportBytes).digest("hex")}`
  };
}

function behavioralPublication(setup) {
  return buildBehavioralPreservationPublication({
    pair: setup.pair,
    baselineReport: behavioralReport(setup.pair, "baseline"),
    candidateReport: behavioralReport(setup.pair, "candidate")
  });
}

async function storeDirectory(repository) {
  const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir: repository });
  assert.equal(resolved.ok, true);
  return path.join(resolved.root, COMMON_PROOF_RECEIPT_DIRECTORY);
}

async function recordsDirectory(repository) {
  const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir: repository });
  assert.equal(resolved.ok, true);
  return path.join(resolved.root, COMMON_PROOF_RECEIPT_DIRECTORY, "records");
}

async function onlyRecordPath(repository) {
  const directory = await recordsDirectory(repository);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  assert.equal(names.length, 1);
  return path.join(directory, names[0]);
}

function recordPathFor(repository, selector) {
  return recordsDirectory(repository).then(
    (directory) => path.join(directory, `${digest(selector)}.json`));
}

test("exports a closed three-family model and positive named bounds", () => {
  assert.deepEqual(Object.keys(COMMON_PROOF_RECEIPT_FAMILIES).sort(), [
    "behavioral_preservation", "test_verification_validity", "write_confinement"
  ]);
  for (const [name, value] of Object.entries(COMMON_PROOF_RECEIPT_LIMITS)) {
    assert.equal(Number.isInteger(value) && value > 0, true, name);
  }
  for (const option of ["root", "path", "authority_digest", "durableRoot", "env"]) {
    assert.throws(() => createCommonProofReceiptStore({
      workspaceDir: "/tmp/unused", [option]: "caller"
    }), (error) => error.code === CODES.AUTHORITY_REJECTED, option);
  }
});

test("publishes and restart-selects all three authenticated owner projections", async (t) => {
  const setup = await pairedSetup(t);
  const store = createCommonProofReceiptStore({ workspaceDir: setup.repository });
  const testReceipt = await store.publishTestVerification(setup.baseline);
  const writeReceipt = await store.publishWriteConfinement(writePublication(setup.repository));
  const pairReceipt = await store.publishBehavioralPreservation(behavioralPublication(setup));
  assert.deepEqual([testReceipt.status, writeReceipt.status, pairReceipt.status],
    ["published", "published", "published"]);

  const restarted = createCommonProofReceiptStore({ workspaceDir: setup.repository });
  const selectedTest = await restarted.select(testReceipt.selector);
  const selectedWrite = await restarted.select(writeReceipt.selector);
  const selectedPair = await restarted.selectIdentity(pairReceipt.identity);
  assert.equal(selectedTest.ok, true);
  assert.equal(selectedTest.projection.evidence_identity.evidence_id,
    setup.baseline.attempt.evidence.evidence_identity.evidence_id);
  assert.equal(selectedWrite.ok, true);
  assert.equal(selectedWrite.projection.evidence.repository, setup.repository);
  assert.equal(selectedPair.ok, true);
  assert.equal(selectedPair.projection.pair_id, setup.pair.pair_id);
  for (const side of ["baseline", "candidate"]) {
    const identity = { ...pairReceipt.identity,
      artifact: "behavioral_preservation_observable_report", side };
    const selectedReport = await restarted.selectIdentity(identity);
    assert.equal(selectedReport.ok, true, side);
    assert.equal(selectedReport.projection.evidence_id,
      setup.pair.pair_evidence.sides.find((entry) => entry.position === side).evidence_id);
  }
});

test("identity heads enforce expected-prior CAS and selection never scans records", async (t) => {
  const repository = await plainRepository(t, "common-proof-head-cas-");
  const store = createCommonProofReceiptStore({
    workspaceDir: repository,
    repositoryAlias: "canonical"
  });
  const first = await store.publishWriteConfinement(
    writePublication(repository, { runId: "run-head-1" }));
  const secondPublication = writePublication(repository, { runId: "run-head-2" });
  await assert.rejects(() => store.publishWriteConfinement(secondPublication),
    (error) => error.code === CODES.CONFLICT);
  const advanced = await store.publishWriteConfinement(secondPublication, {
    expectedPriorSelectorDigest: digestIdentity(first.selector)
  });
  assert.equal(advanced.status, "advanced");
  assert.deepEqual(advanced.identity, first.identity);

  const directory = await recordsDirectory(repository);
  await Promise.all(Array.from({ length: COMMON_PROOF_RECEIPT_LIMITS.population_count + 2 },
    (_unused, index) => writeFile(path.join(directory,
      `${String(index).padStart(64, "a")}.stale`), "{}\n")));
  const selected = await createCommonProofReceiptStore({
    workspaceDir: repository,
    repositoryAlias: "canonical"
  }).selectIdentity(first.identity);
  assert.equal(selected.ok, true, "identity selection reads only its exact head and record");
  assert.equal(selected.projection.evidence.run_id, "run-head-2");
});

test("behavioral visibility is absent until all records are durable and the group head lands",
  async (t) => {
    for (const boundary of [
      "common_proof_behavioral_group_record_temp_created",
      "common_proof_behavioral_group_head_temp_created"
    ]) {
      const setup = await pairedSetup(t);
      let fired = false;
      const crashing = createCommonProofReceiptStore({
        workspaceDir: setup.repository,
        faultInjector: (observed) => {
          if (!fired && observed === boundary) {
            fired = true;
            throw Object.assign(new Error(`fault at ${boundary}`), { code: "injected_fault" });
          }
        }
      });
      await assert.rejects(
        () => crashing.publishBehavioralPreservation(behavioralPublication(setup)),
        (error) => error.code === "injected_fault", boundary);
      assert.equal(fired, true, boundary);
      const identity = {
        schema_version: "wiki-core-common-proof-capture-receipt-identity.v1",
        repository_alias: path.basename(setup.repository),
        wk_id: "WK-2064",
        unit_address: "WK-2064#SLICE-006",
        focus: null,
        family: "behavioral_preservation",
        artifact: "behavioral_preservation_pair_receipt",
        side: null,
        profile_id: "proof.compatibility.behavioral-preservation",
        profile_version: "2.0.0",
        verification_id: "claim-verify-slice-006"
      };
      assert.equal((await crashing.selectIdentity(identity)).code, CODES.ABSENT, boundary);
      const restarted = createCommonProofReceiptStore({ workspaceDir: setup.repository });
      const published = await restarted.publishBehavioralPreservation(behavioralPublication(setup));
      assert.equal((await restarted.selectIdentity(published.identity)).ok, true, boundary);
    }
  });

test("publishes only owner-issued behavioral envelopes and rejects caller-authored carriers",
  async (t) => {
  const setup = await pairedSetup(t);
  const store = createCommonProofReceiptStore({ workspaceDir: setup.repository });
  const reconstructed = Object.freeze(structuredClone(setup.pair));
  assert.throws(() => buildBehavioralPreservationPublication({
    pair: reconstructed,
    baselineReport: behavioralReport(setup.pair, "baseline"),
    candidateReport: behavioralReport(setup.pair, "candidate")
  }),
    (error) => error.code === "behavioral_preservation_pair.evidence_untrusted.v1");
  const raw = {
    pair: setup.pair,
    baselineReport: behavioralReport(setup.pair, "baseline"),
    candidateReport: behavioralReport(setup.pair, "candidate")
  };
  for (const forged of [raw, Object.freeze(structuredClone(behavioralPublication(setup))),
    Object.freeze({ ...behavioralPublication(setup), root: setup.repository })]) {
    await assert.rejects(() => store.publishBehavioralPreservation(forged),
      (error) => error.code ===
        BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES.PUBLICATION_UNTRUSTED);
  }
  await assert.rejects(() => store.publishWriteConfinement({
    ...writePublication(setup.repository), digest: `sha256:${"a".repeat(64)}`
  }), (error) => error.code === CODES.AUTHORITY_REJECTED);
});

test("closed store refusals remain exact while unknown runtime failures escape", async (t) => {
  const repository = await plainRepository(t, "common-proof-fail-loud-");
  const published = await createCommonProofReceiptStore({ workspaceDir: repository })
    .publishWriteConfinement(writePublication(repository));
  for (const code of Object.values(CODES)) {
    const store = createCommonProofReceiptStore({
      workspaceDir: repository,
      faultInjector: (boundary) => {
        if (boundary === "common_proof_identity_before_select") {
          throw Object.assign(new Error(code), { code });
        }
      }
    });
    const result = await store.selectIdentity(published.identity);
    assert.equal(result.code, code, code);
  }
  for (const code of ["EACCES", "EMFILE", "unrecognized_runtime_failure"]) {
    const failure = Object.assign(new Error(code), { code });
    const store = createCommonProofReceiptStore({
      workspaceDir: repository,
      faultInjector: (boundary) => {
        if (boundary === "common_proof_identity_before_select") throw failure;
      }
    });
    await assert.rejects(() => store.selectIdentity(published.identity),
      (error) => error === failure, code);
  }
});

test("restart selection rejects copied records bound to another absolute repository",
  async (t) => {
    const source = await plainRepository(t, "common-proof-source-binding-");
    const target = await plainRepository(t, "common-proof-target-binding-");
    const alias = "canonical-repository";
    const published = await createCommonProofReceiptStore({
      workspaceDir: source, repositoryAlias: alias
    }).publishWriteConfinement(writePublication(source));
    const targetStore = createCommonProofReceiptStore({
      workspaceDir: target, repositoryAlias: alias
    });
    await targetStore.publishWriteConfinement(writePublication(target));
    await rm(await storeDirectory(target), { recursive: true, force: true });
    await cp(await storeDirectory(source), await storeDirectory(target), { recursive: true });
    const result = await createCommonProofReceiptStore({
      workspaceDir: target, repositoryAlias: alias
    }).selectIdentity(published.identity);
    assert.equal(result.code, CODES.PROJECTION_REJECTED);
  });

test("rejects altered test-proof validity evidence carrying its stale digest", async (t) => {
  const setup = await pairedSetup(t);
  const store = createCommonProofReceiptStore({ workspaceDir: setup.repository });
  const altered = structuredClone(setup.baseline.attempt);
  altered.evidence.test_inventory.baseline_id = "coverage-baseline-altered";
  await assert.rejects(() => store.publishTestVerification({
    context: setup.baseline.context, attempt: altered
  }), (error) => error.code === "test_proof_receipt_projection_digest_mismatch");
});

test("all three publication families reject a repository outside the durable workspace", async (t) => {
  const setup = await pairedSetup(t);
  const otherRepository = await plainRepository(t, "common-proof-other-root-");
  const foreignStore = createCommonProofReceiptStore({ workspaceDir: otherRepository });
  await assert.rejects(() => foreignStore.publishTestVerification(setup.baseline),
    (error) => error.code === CODES.PROJECTION_REJECTED);
  await assert.rejects(() => foreignStore.publishBehavioralPreservation(behavioralPublication(setup)),
    (error) => error.code === CODES.PROJECTION_REJECTED);
  await assert.rejects(() => foreignStore.publishWriteConfinement(
    writePublication(setup.repository)),
  (error) => error.code === CODES.PROJECTION_REJECTED);
});

test("byte-identical replay is idempotent and divergent same-identity replay conflicts", async (t) => {
  const repository = await plainRepository(t);
  const store = createCommonProofReceiptStore({ workspaceDir: repository });
  const publication = writePublication(repository);
  const first = await store.publishWriteConfinement(publication);
  const second = await store.publishWriteConfinement(publication);
  assert.equal(first.status, "published");
  assert.equal(second.status, "replayed");
  assert.deepEqual(second.selector, first.selector);
  await assert.rejects(() => store.publishWriteConfinement({
    ...publication, observedAt: "2026-08-30T12:00:01.000Z"
  }), (error) => error.code === CODES.CONFLICT);
});

test("invalid incumbents retain their specific typed precedence during publication", async (t) => {
  for (const [name, mutate, code] of [
    ["truncated", () => "{\"schema_version\":", CODES.CORRUPT],
    ["corrupt", (record) => {
      record.content_identity = `sha256:${"0".repeat(64)}`;
      return canonicalBytes(record);
    }, CODES.CORRUPT],
    ["unsupported-layout", (record) => {
      record.layout_version = "workspace-agent-common-proof-receipt-layout.v9";
      return canonicalBytes(record);
    }, CODES.LAYOUT_UNSUPPORTED],
    ["unsupported-family", (record) => {
      record.selector.family = "nearby_family";
      return canonicalBytes(record);
    }, CODES.FAMILY_UNSUPPORTED],
    ["selector-mismatch", (record) => {
      record.selector.lifecycle.run_id = "run-nearby";
      return resealRecord(record);
    }, CODES.SELECTOR_MISMATCH]
  ]) {
    const repository = await plainRepository(t, `common-proof-incumbent-${name}-`);
    const store = createCommonProofReceiptStore({ workspaceDir: repository });
    const publication = writePublication(repository);
    await store.publishWriteConfinement(publication);
    const target = await onlyRecordPath(repository);
    const record = JSON.parse(await readFile(target, "utf8"));
    await writeFile(target, mutate(record));
    await assert.rejects(() => store.publishWriteConfinement(publication),
      (error) => error.code === code, name);
  }
});

test("every atomic publication boundary leaves absence or one complete receipt", async (t) => {
  const boundaries = ["common_proof_receipt_temp_created", "common_proof_receipt_written",
    "common_proof_receipt_file_synced", "common_proof_receipt_published",
    "common_proof_receipt_directory_synced"];
  for (const boundary of boundaries) {
    const repository = await plainRepository(t, `common-proof-${boundary}-`);
    const publication = writePublication(repository);
    let fired = false;
    const crashing = createCommonProofReceiptStore({
      workspaceDir: repository,
      faultInjector: (observed) => {
        if (!fired && observed === boundary) {
          fired = true;
          throw Object.assign(new Error(`fault at ${boundary}`), { code: "injected_fault" });
        }
      }
    });
    await assert.rejects(() => crashing.publishWriteConfinement(publication),
      (error) => error.code === "injected_fault", boundary);
    assert.equal(fired, true, boundary);
    const restarted = createCommonProofReceiptStore({ workspaceDir: repository });
    const recovered = await restarted.publishWriteConfinement(publication);
    assert.equal(["published", "replayed"].includes(recovered.status), true, boundary);
    const selected = await restarted.select(recovered.selector);
    assert.equal(selected.ok, true, boundary);
  }
});

test("exact selector mismatch, unsupported layout/family, corruption, and truncation fail typed", async (t) => {
  const cases = [
    ["layout", (record) => { record.layout_version = "workspace-agent-common-proof-receipt-layout.v9"; }, CODES.LAYOUT_UNSUPPORTED],
    ["family", (record) => { record.selector.family = "nearby_family"; }, CODES.FAMILY_UNSUPPORTED],
    ["corrupt", (record) => { record.content_identity = `sha256:${"0".repeat(64)}`; }, CODES.CORRUPT]
  ];
  for (const [name, mutate, code] of cases) {
    const repository = await plainRepository(t, `common-proof-${name}-`);
    const store = createCommonProofReceiptStore({ workspaceDir: repository });
    const published = await store.publishWriteConfinement(writePublication(repository));
    const recordPath = await onlyRecordPath(repository);
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    mutate(record);
    await writeFile(recordPath, `${JSON.stringify(record)}\n`);
    const result = await store.select(published.selector);
    assert.equal(result.code, code, name);
  }

  const repository = await plainRepository(t, "common-proof-truncated-");
  const store = createCommonProofReceiptStore({ workspaceDir: repository });
  const published = await store.publishWriteConfinement(writePublication(repository));
  await writeFile(await onlyRecordPath(repository), "{\"schema_version\":");
  assert.equal((await store.select(published.selector)).code, CODES.CORRUPT);

  const mismatchRepository = await plainRepository(t, "common-proof-mismatch-");
  const mismatchStore = createCommonProofReceiptStore({ workspaceDir: mismatchRepository });
  const exact = await mismatchStore.publishWriteConfinement(writePublication(mismatchRepository));
  const nearby = structuredClone(exact.selector);
  nearby.lifecycle.run_id = "run-nearby";
  await copyFile(await onlyRecordPath(mismatchRepository),
    await recordPathFor(mismatchRepository, nearby));
  assert.equal((await mismatchStore.select(nearby)).code, CODES.SELECTOR_MISMATCH);
});

test("stale lifecycle is explicit and retention never substitutes another identity", async (t) => {
  const setup = await pairedSetup(t);
  const store = createCommonProofReceiptStore({ workspaceDir: setup.repository });
  const retained = await store.publishTestVerification(setup.baseline);
  const removed = await store.publishBehavioralPreservation(behavioralPublication(setup));
  await store.markStale(retained.selector);
  assert.equal((await store.select(retained.selector)).code, CODES.STALE);

  const cleanup = await store.cleanup({ retainSelectors: [removed.selector] });
  assert.equal(cleanup.removed, 2, "cleanup removes the unretained receipt and stale marker");
  const exactRemoved = await store.select(removed.selector);
  assert.equal(exactRemoved.ok, true);
  assert.deepEqual(exactRemoved.selector, removed.selector);
  assert.equal((await store.select(retained.selector)).code, CODES.ABSENT,
    "cleanup must not retain or substitute an unretained stale identity");
  await assert.rejects(() => store.markStale(retained.selector),
    (error) => error.code === CODES.ABSENT,
    "an absent exact selector cannot be pre-poisoned by a stale marker");
  assert.equal((await readdir(await recordsDirectory(setup.repository)))
    .some((entry) => entry === `${digest(retained.selector)}.stale`), false);
});

test("readers are lock-free and mutation-free while writers replay concurrently", async (t) => {
  const repository = await plainRepository(t);
  const publication = writePublication(repository);
  const store = createCommonProofReceiptStore({ workspaceDir: repository });
  const published = await store.publishWriteConfinement(publication);
  const directory = path.dirname(await onlyRecordPath(repository));
  const storeDirectory = path.dirname(directory);
  await mkdir(path.join(storeDirectory, ".receipt-store.lock"), { recursive: true });
  const before = (await readdir(directory)).sort();
  const readers = Array.from({ length: 24 }, () => store.select(published.selector));
  const results = await Promise.all(readers);
  assert.equal(results.every((result) => result.ok === true), true);
  assert.deepEqual((await readdir(directory)).sort(), before);
  await rm(path.join(storeDirectory, ".receipt-store.lock"), { recursive: true, force: true });

  const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
    createCommonProofReceiptStore({ workspaceDir: repository })
      .publishWriteConfinement(publication)));
  assert.equal(concurrent.every(({ status }) => status === "replayed"), true);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".json")).length, 1);
});

test("population, request, selector, record, and returned-byte limits fail closed", async (t) => {
  const repository = await plainRepository(t);
  const store = createCommonProofReceiptStore({ workspaceDir: repository });
  const published = await store.publishWriteConfinement(writePublication(repository));
  await store.markStale(published.selector);
  const directory = await recordsDirectory(repository);
  const additions = Array.from({ length: COMMON_PROOF_RECEIPT_LIMITS.population_count - 1 },
    (_unused, index) => writeFile(path.join(directory,
      `${String(index).padStart(64, "0")}.${index % 2 === 0 ? "json" : "stale"}`), "{}\n"));
  await Promise.all(additions);
  assert.equal((await store.select(published.selector)).code, CODES.POPULATION_OVERFLOW);

  const selector = structuredClone(published.selector);
  selector.lifecycle.run_id = "x".repeat(COMMON_PROOF_RECEIPT_LIMITS.selector_string_bytes + 1);
  assert.equal((await store.select(selector)).code, CODES.SELECTOR_INVALID);

  const oversizedRepository = await plainRepository(t, "common-proof-overflow-");
  const oversizedStore = createCommonProofReceiptStore({ workspaceDir: oversizedRepository });
  const oversized = await oversizedStore.publishWriteConfinement(
    writePublication(oversizedRepository));
  await writeFile(await onlyRecordPath(oversizedRepository),
    "x".repeat(COMMON_PROOF_RECEIPT_LIMITS.record_bytes + 1));
  assert.equal((await oversizedStore.select(oversized.selector)).code, CODES.RECORD_OVERFLOW);
  assert.ok(COMMON_PROOF_RECEIPT_LIMITS.returned_bytes <
    COMMON_PROOF_RECEIPT_LIMITS.record_bytes);

  const requestRepository = await plainRepository(t, "common-proof-request-overflow-");
  const requestStore = createCommonProofReceiptStore({ workspaceDir: requestRepository });
  await assert.rejects(() => requestStore.publishWriteConfinement({
    ...writePublication(requestRepository),
    observedAt: "x".repeat(COMMON_PROOF_RECEIPT_LIMITS.request_bytes)
  }), (error) => error.code === CODES.INPUT_OVERFLOW);

  const returnRepository = await plainRepository(t, "common-proof-return-overflow-");
  const returnStore = createCommonProofReceiptStore({ workspaceDir: returnRepository });
  const returnReceipt = await returnStore.publishWriteConfinement(
    writePublication(returnRepository));
  const returnPath = await onlyRecordPath(returnRepository);
  const returnRecord = JSON.parse(await readFile(returnPath, "utf8"));
  const largeProjection = JSON.parse(returnRecord.events[0].projection_bytes);
  largeProjection.padding = "p".repeat(COMMON_PROOF_RECEIPT_LIMITS.returned_bytes + 1);
  returnRecord.events[0].projection_bytes = canonicalBytes(largeProjection);
  const sealed = resealRecord(returnRecord);
  assert.ok(Buffer.byteLength(sealed, "utf8") <= COMMON_PROOF_RECEIPT_LIMITS.record_bytes);
  await writeFile(returnPath, sealed);
  assert.equal((await returnStore.select(returnReceipt.selector)).code, CODES.RETURN_OVERFLOW);
});

test("restart reads reject noncanonical outer and projection encodings", async (t) => {
  const outerRepository = await plainRepository(t, "common-proof-noncanonical-outer-");
  const outerStore = createCommonProofReceiptStore({ workspaceDir: outerRepository });
  const outerReceipt = await outerStore.publishWriteConfinement(
    writePublication(outerRepository));
  const outerPath = await onlyRecordPath(outerRepository);
  const outerRecord = JSON.parse(await readFile(outerPath, "utf8"));
  await writeFile(outerPath, `${JSON.stringify(outerRecord, null, 2)}\n`);
  assert.equal((await outerStore.select(outerReceipt.selector)).code, CODES.CORRUPT);

  const projectionRepository = await plainRepository(t,
    "common-proof-noncanonical-projection-");
  const projectionStore = createCommonProofReceiptStore({ workspaceDir: projectionRepository });
  const projectionReceipt = await projectionStore.publishWriteConfinement(
    writePublication(projectionRepository));
  const projectionPath = await onlyRecordPath(projectionRepository);
  const projectionRecord = JSON.parse(await readFile(projectionPath, "utf8"));
  const projection = JSON.parse(projectionRecord.events[0].projection_bytes);
  projectionRecord.events[0].projection_bytes = `${JSON.stringify(projection, null, 2)}\n`;
  await writeFile(projectionPath, resealRecord(projectionRecord));
  assert.equal((await projectionStore.select(projectionReceipt.selector)).code, CODES.CORRUPT);
});

test("unknown selector family/layout and path-digest-authority fields are rejected", async (t) => {
  const repository = await plainRepository(t);
  const store = createCommonProofReceiptStore({ workspaceDir: repository });
  const published = await store.publishWriteConfinement(writePublication(repository));
  for (const [field, value, code] of [
    ["schema_version", "common-proof-selector.v9", CODES.LAYOUT_UNSUPPORTED],
    ["family", "write_confinement_latest", CODES.FAMILY_UNSUPPORTED]
  ]) {
    const selector = structuredClone(published.selector);
    selector[field] = value;
    assert.equal((await store.select(selector)).code, code);
  }
  for (const field of ["path", "root", "digest", "authority", "latest"]) {
    const selector = { ...published.selector, [field]: "caller" };
    assert.equal((await store.select(selector)).code, CODES.SELECTOR_INVALID, field);
  }
});
