

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs";
import {
  assertTypedCorrectiveFailure
} from "./workspace-agent-corrective-continuation-fixture.mjs";
import {
  assertSurfaceByteIdentical,
  captureSurface,
  reissueCorrectiveDispatch,
  settledIntegratedScenario
} from "./workspace-agent-corrective-integrated-receipt-base-fixture.mjs";

const MUTANT_TAG = "?wk1723-slice-020-mutant=current-wk-tip-admission";
const MANAGED_IDENTITY_RECEIPTS_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity-receipts.mjs",
  import.meta.url
).href;
const MANAGED_IDENTITY_MODULE_URL = new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-managed-identity.mjs",
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
const HISTORICAL_RUNNER_ANCHOR = "        runGit: historicalWkIdentityRunGit\n";
const MANAGED_IDENTITY_RECEIPTS_SPECIFIER_ANCHOR =
  '"./workspace-agent-dispatch-backend-managed-identity-receipts.mjs"';
const MANAGED_IDENTITY_SPECIFIER_ANCHOR = '"./workspace-agent-dispatch-backend-managed-identity.mjs"';
const DISPATCH_BACKEND_SPECIFIER_ANCHOR =
  '"../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs"';

function mutateOnce(source, anchor, replacement, label) {
  assert.equal(source.split(anchor).length, 2, `mutation anchor is not unique: ${label}`);
  const mutated = source.replace(anchor, replacement);
  assert.notEqual(mutated, source, label);
  return mutated;
}

test("WK-1723#SLICE-020 MUTATION: restoring the current-WK-tip admission is killed by committed_range_empty", async (t) => {
  const sources = new Map([
    [`${MANAGED_IDENTITY_RECEIPTS_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(MANAGED_IDENTITY_RECEIPTS_MODULE_URL), "utf8"),
      HISTORICAL_RUNNER_ANCHOR,
      "        runGit: reviewContextRunGit\n",
      "historical WK-identity runner"
    )],
    [`${MANAGED_IDENTITY_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(MANAGED_IDENTITY_MODULE_URL), "utf8"),
      MANAGED_IDENTITY_RECEIPTS_SPECIFIER_ANCHOR,
      JSON.stringify(`${MANAGED_IDENTITY_RECEIPTS_MODULE_URL}${MUTANT_TAG}`),
      "managed identity receipts specifier"
    )],
    [`${DISPATCH_BACKEND_MODULE_URL}${MUTANT_TAG}`, mutateOnce(
      readFileSync(new URL(DISPATCH_BACKEND_MODULE_URL), "utf8"),
      MANAGED_IDENTITY_SPECIFIER_ANCHOR,
      JSON.stringify(`${MANAGED_IDENTITY_MODULE_URL}${MUTANT_TAG}`),
      "managed identity specifier"
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

  const { fx, warm, receipt, liveWkTip } = await settledIntegratedScenario(
    t,
    mutant.createTestDispatchBackend
  );
  assert.equal(liveWkTip, receipt.reviewed_sha);
  assert.equal(fx.receipts.length, 2);
  const before = captureSurface(fx);

  const killed = await reissueCorrectiveDispatch(fx, warm, "mutant-current-wk-tip");
  assert.equal(killed.accepted, false, JSON.stringify(killed));
  assertTypedCorrectiveFailure(
    killed.refusal,
    MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED
  );
  assert.match(killed.refusal.detail.message, /committed_range_empty/u,
    "the kill is the empty reviewed..reviewed range, not an unrelated failure");
  assert.equal(warm.workerLaunches().length, 0, "the mutant creates no worker and no monitor");
  assertSurfaceByteIdentical(fx, before);

  const production = await settledIntegratedScenario(t);
  assert.equal(production.liveWkTip, production.receipt.reviewed_sha);
  const accepted = await reissueCorrectiveDispatch(
    production.fx,
    production.warm,
    "production-current-witness"
  );
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  assert.equal(production.warm.workerLaunches().length, 1);
});
