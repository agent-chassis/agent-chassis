import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getRuntimeBlockerEntry,
  loadRuntimeBlockerTaxonomy
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

test("ready-slice recovery uses saved-unit prerequisites", async () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const rolePolicy = getRuntimeBlockerEntry("role_policy_violation");
  assert.ok(taxonomy.codes.some(({ code }) => code === rolePolicy.code));
  const reason = rolePolicy.reasons.find(
    (entry) => entry.reason === "reviewer_write_scope_nonempty"
  );
  assert.ok(reason);

  assert.equal(rolePolicy.code, "role_policy_violation");
  assert.equal(rolePolicy.category, "role_policy");
  assert.equal(rolePolicy.actor_recovery, "coordinator");
  assert.equal(rolePolicy.blocking, true);
  assert.equal(reason.remediation.action,
    "create_or_select_separate_findings_only_review_unit");
  assert.equal(reason.remediation.kind, "structured_route");
  assert.equal(reason.remediation.route, "workspace_work_record_ready_slice");
  assert.deepEqual(reason.remediation.arguments, {
    shaping_mode: "review",
    review_purpose: "standalone",
    work_kind: "review",
    write_scope: []
  });
  assert.deepEqual(reason.remediation.argument_bindings, {
    unit: "reviewed_parent_wk_unit",
    title: "review_objective_title",
    repo_paths: "reviewed_implementation_paths",
    depends_on: "reviewed_implementation_unit",
    acceptance: "review_acceptance_contract"
  });
  assert.match(reason.remediation.success_condition,
    /acknowledges saving a server-allocated findings-only slice/u);
  assert.match(reason.remediation.success_condition,
    /workspace_work_record_summary or workspace_read_page with selected_slice/u);
  assert.doesNotMatch(reason.remediation.success_condition,
    /returns a .*state|returns a ready findings unit/u);

  const helper = await readFile(new URL(
    "../../packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs",
    import.meta.url
  ), "utf8");
  assert.match(helper,
    /workspace_work_record_ready_slice acknowledges saving a findings unit/u);
  assert.match(helper,
    /workspace_work_record_summary or workspace_read_page with selected_slice confirms/u);
  assert.match(helper, /has an empty write_scope before dispatch/u);
});
