import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getRuntimeBlockerEntry,
  loadRuntimeBlockerTaxonomy
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { refuseFindingsOnlyAdmission } from
  "../../packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs";
import * as reviewerPolicy from "../../packages/agent-launch-cli/src/lib/reviewer-write-scope-policy.mjs";

const RETIRED = /workspace_(?:work_record_ready_slice|work_record_summary|read_page|agent_dispatch)/u;
const SUBJECT = "WK-9000#SLICE-001";

function admit(subject, role = "reviewer") {
  const envelopes = [];
  return refuseFindingsOnlyAdmission({
    args: { role, subject: SUBJECT }, subjectKind: "work_record_slice", initiativeSubjectKind: "initiative",
    workspace: { dir: "/dev/null/workspace" }, dispatchBackend: {}, loadSubject: async () => subject,
    buildBlocked: (input) => input, jsonContent: (value) => { envelopes.push(value); return value; }
  });
}

test("the reviewer write-scope reason keeps its policy and offers no separate review unit", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const rolePolicy = getRuntimeBlockerEntry("role_policy_violation");
  assert.ok(taxonomy.codes.some(({ code }) => code === rolePolicy.code));
  const reason = rolePolicy.reasons.find((entry) => entry.reason === "reviewer_write_scope_nonempty");
  assert.ok(reason);
  assert.deepEqual([rolePolicy.category, rolePolicy.actor_recovery, rolePolicy.blocking],
    ["role_policy", "coordinator", true]);
  assert.deepEqual(reason.required_write_scope, []);
  assert.equal(Object.hasOwn(reason, "remediation"), false);
  assert.doesNotMatch(JSON.stringify(reason), RETIRED);
});

test("a write-bearing subject is admitted for read-only review; an unresolved one offers no call", async () => {
  for (const role of ["reviewer", "redteam"]) {
    assert.equal(await admit({ write_scope: ["packages/example/src/a.mjs"] }, role), null, role);
    assert.equal(await admit({ write_scope: [] }, role), null, role);
  }
  const refused = await admit(null);
  assert.equal(refused.reason, "reviewer_subject_unreadable");
  assert.equal(refused.refusal.no_supported_route, true);
  assert.equal(Object.hasOwn(refused.refusal, "next_calls"), false);
  assert.equal(refused.refusal.route, "start_agent");
  assert.doesNotMatch(JSON.stringify(refused), RETIRED);
});

test("effective reviewer mutation scope stays enforced without an authoring instruction", async () => {
  const violated = reviewerPolicy.buildReviewerEmptyScopeAssertion(["packages/example/src/a.mjs"], false);
  assert.deepEqual([violated.enforced, violated.write_scope_length, violated.refusal_reason],
    [false, 1, reviewerPolicy.REVIEWER_WRITE_SCOPE_NONEMPTY_REASON]);
  const empty = reviewerPolicy.buildReviewerEmptyScopeAssertion([], true);
  assert.deepEqual([empty.enforced, empty.write_scope_length, empty.refusal_reason], [true, 0, null]);
  const detail = reviewerPolicy.buildReviewerWriteScopeRefusalDetail({ subject: SUBJECT, observedWriteScopeSize: 1 });
  assert.deepEqual([detail.subject, detail.role, detail.observed_write_scope_size, detail.required_write_scope],
    [SUBJECT, "reviewer", 1, []]);
  assert.equal(Object.hasOwn(detail, "remediation"), false);
  assert.deepEqual(Object.keys(reviewerPolicy).sort(), ["REVIEWER_WRITE_SCOPE_NONEMPTY_REASON",
    "buildReviewerEmptyScopeAssertion", "buildReviewerWriteScopeRefusalDetail"]);
  for (const file of ["packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs",
    "packages/agent-launch-cli/src/lib/reviewer-write-scope-policy.mjs"]) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, RETIRED, file);
    assert.doesNotMatch(source, /WK-#####|suggested_unit_id_examples/u, file);
  }
});
