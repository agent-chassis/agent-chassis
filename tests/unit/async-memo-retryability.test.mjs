

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createEvictOnRejectionMemo,
  createIsolatedCompiledValidatorCache
} from "../../packages/controlled-contract/lib/compiled-validator-cache.mjs";
import {
  WIKI_CORE_EVALUATION_INPUT_GROUPS
} from "../../packages/controlled-contract/lib/validator-population.mjs";
import {
  EVALUATION_INPUT_VALIDATOR_GROUP,
  loadControlledContractPackage,
  loadEvaluationInputSchema,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
} from "../../packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs";
import * as toolShared from
  "../../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function countingLoad({ failures = 1, value = "resolved" } = {}) {
  const state = { attempts: 0 };
  const load = async () => {
    state.attempts += 1;
    if (state.attempts <= failures) {
      const error = new Error(`injected attempt ${state.attempts}`);
      error.attempt = state.attempts;
      throw error;
    }
    return typeof value === "function" ? value(state.attempts) : value;
  };
  return { state, load };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: "expected the attempt to reject" });
}

test("a rejected attempt is evicted before the next authorized attempt", async () => {
  const { state, load } = countingLoad();
  const memo = createEvictOnRejectionMemo(load);

  const first = await rejectionOf(memo());
  assert.equal(first.attempt, 1);
  assert.equal(state.attempts, 1);

  assert.equal(await memo(), "resolved");
  assert.equal(state.attempts, 2, "the next authorized attempt re-executed the load");
});

test("concurrent callers share one pending attempt", async () => {
  const { state, load } = countingLoad({ failures: 0 });
  const memo = createEvictOnRejectionMemo(load);

  const results = await Promise.all([memo(), memo(), memo()]);
  assert.deepEqual(results, ["resolved", "resolved", "resolved"]);
  assert.equal(state.attempts, 1, "three concurrent callers ran one load");
});

test("concurrent callers of a failing attempt share that one attempt too", async () => {
  const { state, load } = countingLoad();
  const memo = createEvictOnRejectionMemo(load);

  const settled = await Promise.allSettled([memo(), memo(), memo()]);
  assert.deepEqual(settled.map(({ status }) => status),
    ["rejected", "rejected", "rejected"]);
  assert.equal(state.attempts, 1, "eviction did not turn one failure into three loads");
  assert.equal(await memo(), "resolved");
  assert.equal(state.attempts, 2);
});

test("a fulfilled attempt stays memoized", async () => {
  const { state, load } = countingLoad({ failures: 0, value: (n) => `value-${n}` });
  const memo = createEvictOnRejectionMemo(load);

  assert.equal(await memo(), "value-1");
  assert.equal(await memo(), "value-1");
  assert.equal(await memo(), "value-1");
  assert.equal(state.attempts, 1, "success is cached, not re-executed");
});

test("a synchronous throw is evicted like an asynchronous rejection", async () => {
  let attempts = 0;
  const memo = createEvictOnRejectionMemo(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("synchronous");
    return Promise.resolve("recovered");
  });

  assert.equal((await rejectionOf(memo())).message, "synchronous");
  assert.equal(await memo(), "recovered");
  assert.equal(attempts, 2);
});

test("eviction is identity-guarded against a stale rejection handler", async () => {

  let attempts = 0;
  const gate = [];
  const memo = createEvictOnRejectionMemo(() => {
    attempts += 1;
    const current = attempts;
    return new Promise((resolve, reject) => {
      gate.push(() => (current === 1 ? reject(new Error("slow")) : resolve(`ok-${current}`)));
    });
  });

  const firstAttempt = memo();
  gate[0]();
  await rejectionOf(firstAttempt);

  const secondAttempt = memo();
  assert.equal(attempts, 2);
  gate[1]();
  assert.equal(await secondAttempt, "ok-2");

  assert.equal(await memo(), "ok-2");
  assert.equal(attempts, 2);
});

async function isolatedRoot(t, label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `wk2382-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const EVALUATION_INPUT_SCHEMA_PATH = path.join(
  REPO,
  "packages/controlled-contract/schema",
  "controlled-contract-verification-profile-input.v1.schema.json"
);

test("a failed group resolution is evicted and the next attempt re-resolves", async (t) => {
  const cacheRoot = await isolatedRoot(t, "group");
  const schema = JSON.parse(await readFile(EVALUATION_INPUT_SCHEMA_PATH, "utf8"));

  const refusing = createIsolatedCompiledValidatorCache(cacheRoot, { allowGeneration: false });
  const failure = await rejectionOf(refusing.compiledValidators(
    EVALUATION_INPUT_VALIDATOR_GROUP,
    { validators: { validateEvaluationInput: schema } }
  ));
  assert.equal(failure.code, "validator_cache_unavailable");

  const generating = createIsolatedCompiledValidatorCache(cacheRoot);
  const { validateEvaluationInput } = await generating.compiledValidators(
    EVALUATION_INPUT_VALIDATOR_GROUP,
    { validators: { validateEvaluationInput: schema } }
  );
  assert.equal(typeof validateEvaluationInput, "function");

  assert.equal(validateEvaluationInput({}), false);
  assert.equal(Array.isArray(validateEvaluationInput.errors), true);

  const again = await generating.compiledValidators(
    EVALUATION_INPUT_VALIDATOR_GROUP,
    { validators: { validateEvaluationInput: schema } }
  );
  assert.equal(again.validateEvaluationInput, validateEvaluationInput,
    "a fulfilled group resolution stays memoized");
});

test("a failed population status is evicted and the next attempt re-runs the pass", async (t) => {
  const cacheRoot = await isolatedRoot(t, "population");

  const refusing = createIsolatedCompiledValidatorCache(cacheRoot, { allowGeneration: false });
  const failure = await rejectionOf(refusing.load());
  assert.equal(typeof failure.code, "string");

  const second = await rejectionOf(refusing.load());
  assert.equal(second.code, failure.code);

  const generating = createIsolatedCompiledValidatorCache(cacheRoot);
  const status = await generating.load();
  assert.equal(status.result, "miss");
  assert.equal(status.group_count > 0, true);

  assert.equal(await generating.load(), status);
});

test("the whole declared population compiles each schema under one group identity", async (t) => {
  const cacheRoot = await isolatedRoot(t, "identity");
  const cache = createIsolatedCompiledValidatorCache(cacheRoot);
  const status = await cache.load();

  const ids = status.groups.map(({ group_id: id }) => id);
  assert.equal(new Set(ids).size, ids.length, "no group identity is declared twice");

  const evaluationInputGroups = ids.filter((id) => id.startsWith("wiki-core."));
  assert.deepEqual(evaluationInputGroups, [...WIKI_CORE_EVALUATION_INPUT_GROUPS]);
  assert.deepEqual(evaluationInputGroups, [EVALUATION_INPUT_VALIDATOR_GROUP],
    "package-runtime's group is the one retained wiki-core evaluation-input identity");
  assert.equal(
    ids.includes("wiki-core.controlled-contract-tool-shared.evaluation-input.v1"),
    false,
    "the duplicate tool-shared group identity is no longer declared"
  );
});

test("the retired tool-shared group identity is a typed refusal, not a second compilation",
  async (t) => {
    const cacheRoot = await isolatedRoot(t, "retired");
    const cache = createIsolatedCompiledValidatorCache(cacheRoot);
    const schema = JSON.parse(await readFile(EVALUATION_INPUT_SCHEMA_PATH, "utf8"));

    const failure = await rejectionOf(cache.compiledValidators(
      "wiki-core.controlled-contract-tool-shared.evaluation-input.v1",
      { validators: { validateEvaluationInput: schema } }
    ));
    assert.equal(failure.code, "validator_cache_group_undeclared");
  });

test("each named package-runtime loader resolves and stays memoized", async () => {
  const [packageApi, requestSchema, inputSchema, validator] = await Promise.all([
    loadControlledContractPackage(),
    loadProofPlanRequestSchema(),
    loadEvaluationInputSchemaValue(),
    loadEvaluationInputSchema()
  ]);

  assert.equal(typeof packageApi.buildProofPlan, "function");
  assert.equal(typeof requestSchema, "object");
  assert.equal(typeof inputSchema, "object");
  assert.equal(typeof validator, "function");

  assert.equal(await loadControlledContractPackage(), packageApi);
  assert.equal(await loadProofPlanRequestSchema(), requestSchema);
  assert.equal(await loadEvaluationInputSchemaValue(), inputSchema);
  assert.equal(await loadEvaluationInputSchema(), validator);
});

test("the evaluation-input validator preserves its synchronous public result shape", async () => {
  const validate = await loadEvaluationInputSchema();
  const outcome = validate({});
  assert.equal(typeof outcome, "boolean", "the compiled validator returns synchronously");
  assert.equal(outcome, false);
  const [first] = validate.errors;
  for (const field of ["instancePath", "schemaPath", "keyword", "params", "message"]) {
    assert.equal(Object.hasOwn(first, field), true, `Ajv diagnostic field ${field} survives`);
  }
});

test("tool-shared forwards to the single owner instead of holding a second loader",
  async () => {

    assert.equal(toolShared.loadControlledContractPackage, loadControlledContractPackage);
    assert.equal(await toolShared.generationEvaluationInputValidator(),
      await loadEvaluationInputSchema());
  });

test("no in-scope loader retains a rejection through a bare ??= memo", async () => {

  const sources = Object.fromEntries(await Promise.all([
    "packages/controlled-contract/lib/compiled-validator-cache.mjs",
    "packages/controlled-contract/lib/validator-population.mjs",
    "packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs",
    "packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs"
  ].map(async (rel) => [rel, await readFile(path.join(REPO, rel), "utf8")])));

  const toolSharedSource = sources["packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs"];

  for (const removed of [
    "controlledContractPackagePromise",
    "generationEvaluationInputValidatorPromise",
    "CONTROLLED_CONTRACT_VALIDATOR_CACHE_SPECIFIER",
    "wiki-core.controlled-contract-tool-shared.evaluation-input.v1"
  ]) {
    assert.equal(toolSharedSource.includes(removed), false,
      `tool-shared still carries the duplicate ${removed}`);
  }

  const runtimeSource = sources["packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs"];
  for (const loader of [
    "loadControlledContractPackage",
    "loadProofPlanRequestSchema",
    "loadEvaluationInputSchemaValue",
    "loadEvaluationInputSchema"
  ]) {
    assert.match(runtimeSource, new RegExp(`const ${loader} = createEvictOnRejectionMemo\\(`, "u"),
      `${loader} is not built from the shared settlement owner`);
  }

  const accepted = new Map([
    ["packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs",
      ["controlledContractTestProofPromise", "carrierSetToolsPromise"]]
  ]);
  for (const [rel, source] of Object.entries(sources)) {
    const memos = [...source.matchAll(/^\s*(?:let\s+)?(\w*[Pp]romise\w*)\s*\?\?=/gmu)]
      .map((match) => match[1]);
    assert.deepEqual(memos, accepted.get(rel) ?? [],
      `${rel} carries an unaccepted bare ??= promise memo`);
  }
});

test("the accepted static-module-map loaders keep their original settlement shape",
  async () => {

    const source = await readFile(path.join(REPO,
      "packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs"), "utf8");

    assert.match(source,
      /controlledContractTestProofPromise \?\?= import\(CONTROLLED_CONTRACT_TEST_PROOF_SPECIFIER\)/u);
    assert.match(source,
      /carrierSetToolsPromise \?\?= import\("\.\/controlled-contract-carrier-set-tools\.mjs"\)/u);
    assert.equal(source.includes("createEvictOnRejectionMemo"), false,
      "the accepted sites must not consume the eviction owner");

    assert.equal(typeof (await toolShared.loadControlledContractTestProofPackage()), "object");
  });
