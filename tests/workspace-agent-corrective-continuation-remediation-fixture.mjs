

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  git,
  SLICE_REF,
  structured,
  SUBJECT
} from "./workspace-agent-corrective-continuation-fixture.mjs";

export async function commitRemediationRound(fx, workerInput, bytes) {
  const binding = workerInput.worktree_provisioning.slice_binding;
  writeFileSync(path.join(fx.worktree, "src", "canary.txt"), bytes);
  const committed = structured(await fx.registerCommit({
    WIKI_MCP_ASSIGNED_UNIT: SUBJECT,
    WIKI_MCP_COMMIT_LAUNCH_REF: binding.launch_ref,
    WIKI_MCP_COMMIT_RUN_ID: binding.run_id,
    WIKI_MCP_COMMIT_RETRY_ID: "0"
  })({}));
  assert.equal(committed.committed, true, JSON.stringify(committed));
  return git(fx.repo, "rev-parse", SLICE_REF);
}

export function reopenParentForRemediation(fx) {
  const recordPath = path.join(fx.repo, "wiki", "work-records", "WK-1712.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  record.status = "active";
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

export function killLiveAttempt(fx, generation) {
  fx.currentProcs[5252] = String(900 + generation);
}

function multiRoundCanary(slots) {
  return slots
    .map((value, index) => [
      `slot-${index + 1}: ${value}`,
      ...Array.from({ length: 8 }, (_, line) => `filler-${index + 1}-${line}`)
    ].join("\n"))
    .join("\n")
    .concat("\n");
}
export const MULTI_ROUND_BASE = multiRoundCanary(["base", "base", "base"]);
export const MULTI_ROUND_DELIVERIES = Object.freeze([
  multiRoundCanary(["round one", "base", "base"]),
  multiRoundCanary(["round one", "round two", "base"]),
  multiRoundCanary(["round one", "round two", "round three"])
]);
