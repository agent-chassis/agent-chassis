import test from "node:test";
import assert from "node:assert/strict";

const RUNTIME_PACKAGE_SPECIFIER =
  "@agent-chassis/agent-launch-cli/src/lib/codex-role-orchestrator-runtime.mjs";

test("WK-1745 M001: installed Codex orchestrator runtime exposes no fault injector",
  async () => {
    const runtime = await import(RUNTIME_PACKAGE_SPECIFIER);

    assert.equal(Object.hasOwn(runtime, "__testing"), false);
    assert.equal(
      Object.hasOwn(runtime, "armPostReadinessProtocolFailureForTesting"),
      false
    );

    const callableFaultControls = Object.entries(runtime)
      .filter(([name, value]) => typeof value === "function" &&
        /(?:arm|inject).*(?:failure|protocol|readiness|restart)|(?:failure|protocol|readiness|restart).*(?:arm|inject)/iu
          .test(name))
      .map(([name]) => name);
    assert.deepEqual(callableFaultControls, [],
      "wildcard package resolution must not expose a renamed fault controller");

    assert.equal(typeof runtime.runInteractiveOrchestratorChild, "function");
    assert.equal(runtime.isOperatorOrchestratorInteractivePlan({
      mode: "interactive",
      role: "orch"
    }), true, "the installed production runtime remains functional");

    const interactiveRuntimeSource =
      Function.prototype.toString.call(runtime.runInteractiveOrchestratorChild);
    assert.match(interactiveRuntimeSource,
      /spawnOrchestrator\s*=\s*spawnOrchestratorAndWait/u,
      "the package runtime must retain canonical interactive supervision");
    assert.match(interactiveRuntimeSource, /spawnLaunch\s*=\s*spawnIsolated/u,
      "the package runtime must retain the canonical spawnIsolated composition");
  });
