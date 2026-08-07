

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  git,
  SLICE_REF
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  assertCorrectiveSurfaceUnchanged,
  assertRefusedBeforeSpawn,
  captureCorrectiveSurface,
  reissueWarmWorkerDispatch,
  reopenIntegratedTargetForCorrection,
  warmCorrectiveScenario
} from "./workspace-agent-corrective-continuation-warm-fixture.mjs";

const MUTANT_TAG = "?wk1723-slice-020-mutant=unconditional-review-only-resolution";
const INTEGRATION_CONTINUATION_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration-continuation.mjs",
  import.meta.url
).href;
const INTEGRATION_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs",
  import.meta.url
).href;
const DISPATCH_BACKEND_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs",
  import.meta.url
).href;
const SHARED_BACKEND_MODULE_URL = new URL(
  "./workspace-agent-dispatch-backend-shared.mjs",
  import.meta.url
).href;
const BOOTSTRAP_GATE_ANCHOR =
  "    if (isCanonicalCorrectiveContinuationTuple(subject)) return null;\n";
const INTEGRATION_CONTINUATION_SPECIFIER_ANCHOR =
  '"./workspace-agent-dispatch-backend-integration-continuation.mjs"';
const INTEGRATION_SPECIFIER_ANCHOR = '"./workspace-agent-dispatch-backend-integration.mjs"';
const DISPATCH_BACKEND_SPECIFIER_ANCHOR =
  '"../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs"';

function mutateOnce(source, anchor, replacement, label) {
  assert.equal(source.split(anchor).length, 2, `mutation anchor is not unique: ${label}`);
  const mutated = source.replace(anchor, replacement);
  assert.notEqual(mutated, source, label);
  return mutated;
}

test("WK-1723#SLICE-020 MUTATION: restoring the unconditional review-only resolution is killed by the warm corrective redispatch", async (t) => {
  const productionBytes = readFileSync(new URL(INTEGRATION_CONTINUATION_MODULE_URL), null);
  const sources = new Map([
    [`${INTEGRATION_CONTINUATION_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      productionBytes.toString("utf8"), BOOTSTRAP_GATE_ANCHOR, "", "bootstrap gate"
    )],
    [`${INTEGRATION_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(INTEGRATION_MODULE_URL), "utf8"),
      INTEGRATION_CONTINUATION_SPECIFIER_ANCHOR,
      JSON.stringify(`${INTEGRATION_CONTINUATION_MODULE_URL}${MUTANT_TAG}`),
      "integration continuation specifier"
    )],
    [`${DISPATCH_BACKEND_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(DISPATCH_BACKEND_MODULE_URL), "utf8"),
      INTEGRATION_SPECIFIER_ANCHOR,
      JSON.stringify(`${INTEGRATION_MODULE_URL}${MUTANT_TAG}`),
      "integration specifier"
    )],
    [`${SHARED_BACKEND_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(SHARED_BACKEND_MODULE_URL), "utf8"),
      DISPATCH_BACKEND_SPECIFIER_ANCHOR,
      JSON.stringify(`${DISPATCH_BACKEND_MODULE_URL}${MUTANT_TAG}`),
      "dispatch backend specifier"
    )]
  ]);
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const source = sources.get(url);
      return source === undefined
        ? nextLoad(url, context)
        : { format: "module", shortCircuit: true, source };
    }
  });
  t.after(() => hooks.deregister());

  const mutant = await import(`${SHARED_BACKEND_MODULE_URL}${MUTANT_TAG}`);
  assert.equal(typeof mutant.createTestDispatchBackend, "function");

  const { fx, warm, deliveredTip } = await warmCorrectiveScenario(t, mutant.createTestDispatchBackend);

  assert.equal(fx.receipts.length, 2);
  assert.equal(git(fx.repo, "rev-parse", SLICE_REF), deliveredTip);
  const before = captureCorrectiveSurface(fx);

  await assert.rejects(
    () => reissueWarmWorkerDispatch(fx, warm, "warm-corrective-mutant"),
    (error) => {
      assert.match(
        error.message,
        /canonical slice WK-1712#SLICE-001 is not an implementation slice under slice-level review/u
      );
      assert.equal(error instanceof assert.AssertionError, false,
        "the kill is the production refusal, not a failed assertion");

      assert.match(error.stack, /at resolveCorrectiveFindingsContext /u);
      return true;
    }
  );
  assert.equal(warm.workerLaunches().length, 0, "the mutant creates no worker and no monitor");
  assertCorrectiveSurfaceUnchanged(fx, before);

  assert.deepEqual(readFileSync(new URL(INTEGRATION_CONTINUATION_MODULE_URL), null), productionBytes,
    "the production module must be byte-identical throughout");
});

const PROJECTION_MUTANT_TAG = "?wk1793-slice-002-mutant=message-only-identity-check-projection";
const LAUNCH_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-launch.mjs",
  import.meta.url
).href;
const RUN_LIFECYCLE_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle.mjs",
  import.meta.url
).href;

const STRUCTURED_PROJECTION_ANCHOR = "          projectManagedIdentityCheckFailure(error)\n";
const MESSAGE_ONLY_PROJECTION = "          { message: error?.message ?? String(error) }\n";
const LAUNCH_SPECIFIER_ANCHOR = '"./workspace-agent-dispatch-run-lifecycle-launch.mjs"';
const RUN_LIFECYCLE_SPECIFIER_ANCHOR = '"./workspace-agent-dispatch-run-lifecycle.mjs"';

test("WK-1793#SLICE-002 MUTATION: restoring the message-only identity-check projection is killed by the actionable todo/todo refusal", async (t) => {
  const productionBytes = readFileSync(new URL(LAUNCH_MODULE_URL), null);
  const sources = new Map([
    [`${LAUNCH_MODULE_URL}${PROJECTION_MUTANT_TAG}`, mutateOnce(
      productionBytes.toString("utf8"),
      STRUCTURED_PROJECTION_ANCHOR,
      MESSAGE_ONLY_PROJECTION,
      "structured projection"
    )],
    [`${RUN_LIFECYCLE_MODULE_URL}${PROJECTION_MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(RUN_LIFECYCLE_MODULE_URL), "utf8"),
      LAUNCH_SPECIFIER_ANCHOR,
      JSON.stringify(`${LAUNCH_MODULE_URL}${PROJECTION_MUTANT_TAG}`),
      "launch specifier"
    )],
    [`${DISPATCH_BACKEND_MODULE_URL}${PROJECTION_MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(DISPATCH_BACKEND_MODULE_URL), "utf8"),
      RUN_LIFECYCLE_SPECIFIER_ANCHOR,
      JSON.stringify(`${RUN_LIFECYCLE_MODULE_URL}${PROJECTION_MUTANT_TAG}`),
      "run lifecycle specifier"
    )],
    [`${SHARED_BACKEND_MODULE_URL}${PROJECTION_MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(SHARED_BACKEND_MODULE_URL), "utf8"),
      DISPATCH_BACKEND_SPECIFIER_ANCHOR,
      JSON.stringify(`${DISPATCH_BACKEND_MODULE_URL}${PROJECTION_MUTANT_TAG}`),
      "dispatch backend specifier"
    )]
  ]);
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const source = sources.get(url);
      return source === undefined
        ? nextLoad(url, context)
        : { format: "module", shortCircuit: true, source };
    }
  });
  t.after(() => hooks.deregister());

  const mutant = await import(`${SHARED_BACKEND_MODULE_URL}${PROJECTION_MUTANT_TAG}`);
  assert.equal(typeof mutant.createTestDispatchBackend, "function");

  const { fx, warm } = await warmCorrectiveScenario(t, mutant.createTestDispatchBackend);
  reopenIntegratedTargetForCorrection(fx, { parentStatus: "todo", sliceStatus: "todo" });
  const before = captureCorrectiveSurface(fx);

  const refused = await reissueWarmWorkerDispatch(fx, warm, "wk1793-projection-mutant");
  const detail = assertRefusedBeforeSpawn(refused, "mutant todo/todo");

  assert.match(detail.message,
    /agent_launch\.managed_run\.corrective_integrated_state_unresolved\.v1/u);
  assert.match(detail.message, /canonical integrated lifecycle state is impossible/u);

  assert.deepEqual(Object.keys(detail), ["message"],
    `the mutant must project message only: ${JSON.stringify(detail)}`);
  for (const field of ["code", "cause_code", "observed_canonical_status", "recovery"]) {
    assert.equal(Object.hasOwn(detail, field), false, `${field} survives the mutant`);
  }

  assert.equal(warm.workerLaunches().length, 0, "the mutant creates no worker and no monitor");
  assertCorrectiveSurfaceUnchanged(fx, before);

  assert.deepEqual(readFileSync(new URL(LAUNCH_MODULE_URL), null), productionBytes,
    "the production module must be byte-identical throughout");
});
