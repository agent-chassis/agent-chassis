import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const integrationSource = await readFile(
  new URL("../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs", import.meta.url),
  "utf8"
);

test("free/local integration keeps the advisory review matrix outside authority", () => {
  const matrix = [
    ["clean", "present", "valid", "none", "valid"],
    ["findings", "missing", "malformed", "challenged", "invalid"],
    ["invalid", "malformed", "absent", "present", "missing"]
  ];

  assert.deepEqual(matrix.map((row) => row.length), [5, 5, 5,]);
  assert.match(integrationSource, /const cceConfigured = isPlainObject\(sliceIntegrationCcePolicy\)/u);
  assert.match(integrationSource, /const orchestratorDispositions = cceConfigured\n\s+\? normalizeAdvisoryDispositions\(dispositions, evidence\)\n\s+: null;/u);
  assert.doesNotMatch(integrationSource, /DISPOSITION_INVALID/u);
  assert.doesNotMatch(
    integrationSource,
    /if \(orchestratorDispositions === null\) \{\s*return ccePolicyRefusal/u
  );
});

test("configured CCE remains the only branch that receives normalized dispositions", () => {
  const dispositionGate = integrationSource.indexOf("const cceConfigured");
  const normalization = integrationSource.lastIndexOf("normalizeAdvisoryDispositions(dispositions, evidence)");
  const policyInput = integrationSource.lastIndexOf("orchestrator_dispositions: orchestratorDispositions");

  assert.notEqual(policyInput, -1);
  assert.ok(dispositionGate < normalization);
  assert.ok(normalization < policyInput);
  assert.match(integrationSource, /Configured CCE may consume a valid normalized disposition set/u);
});
