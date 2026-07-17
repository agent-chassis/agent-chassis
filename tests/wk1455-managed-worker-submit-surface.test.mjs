import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy
} from "../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";

const COMMIT = "commit";
const SUBMIT = "workspace_submit_for_review";

test("WK-1455#SLICE-020 managed workers retain commit but cannot independently submit for review", () => {
  const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
  const grants = resolveRoleToolGrantsFromPolicy(policy);

  assert.equal(grants.get("worker")?.has(COMMIT), true);
  assert.equal(grants.get("worker")?.has(SUBMIT), false);
  assert.equal(shouldExposeTool("worker", COMMIT), true);
  assert.equal(shouldExposeTool("worker", SUBMIT), false);

  for (const role of ["reviewer", "redteam", "operator"]) {
    assert.equal(grants.get(role)?.has(SUBMIT), true, `${role} submit access must remain unchanged`);
    assert.equal(shouldExposeTool(role, SUBMIT), true, `${role} submit exposure must remain unchanged`);
  }
  assert.equal(grants.get("orchestrator")?.has(SUBMIT), false);
  assert.equal(shouldExposeTool("orchestrator", SUBMIT), false);
});
