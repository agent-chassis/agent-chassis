

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockedDispatchResult,
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult
} from "../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import {
  buildNextCall,
  projectNextActionScalar
} from "../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

const BUILDERS = [
  ["buildBlockedDispatchResult", buildBlockedDispatchResult],
  ["buildBlockedRunStatusResult", buildBlockedRunStatusResult],
  ["buildBlockedRunWaitResult", buildBlockedRunWaitResult]
];

const BLOCKED_ARGS = { blockerCode: "operator_recovery_needed", reason: "blocked_for_test" };

function sampleRecommendedList() {
  return [
    buildNextCall({ tool: "workspace_validate_dispatch", arguments: { unit: "WK-0001" }, recommended: true }),
    buildNextCall({ tool: "workspace_agent_faq", recommended: true }),
    buildNextCall({ tool: "workspace_read_work_record" })
  ];
}

for (const [name, build] of BUILDERS) {
  test(`${name}: next_action is the projection of the supplied nextCalls list`, () => {
    const list = sampleRecommendedList();
    const expected = projectNextActionScalar(list);

    assert.equal(expected, 'workspace_validate_dispatch({unit:"WK-0001"})');

    const result = build({ ...BLOCKED_ARGS, nextCalls: list });
    assert.equal(result.next_action, expected);
  });

  test(`${name}: a list with no recommended entry projects to no next_action key`, () => {
    const list = [buildNextCall({ tool: "workspace_read_work_record" })];
    assert.equal(projectNextActionScalar(list), null);

    const result = build({ ...BLOCKED_ARGS, nextCalls: list });
    assert.equal(Object.prototype.hasOwnProperty.call(result, "next_action"), false);
  });

  test(`${name}: shape is unchanged when neither a list nor a scalar remedy is supplied`, () => {
    const result = build({ ...BLOCKED_ARGS });
    assert.equal(Object.prototype.hasOwnProperty.call(result, "next_action"), false);
    assert.equal(result.accepted, false);
    assert.equal(result.blocker.code, "operator_recovery_needed");
  });

  test(`${name}: the back-compat scalar nextAction still materializes the key`, () => {
    const result = build({ ...BLOCKED_ARGS, nextAction: "do_this_remedy" });
    assert.equal(result.next_action, "do_this_remedy");
  });

  test(`${name}: a supplied list is authoritative over a scalar nextAction`, () => {
    const list = sampleRecommendedList();
    const result = build({ ...BLOCKED_ARGS, nextAction: "legacy_scalar", nextCalls: list });
    assert.equal(result.next_action, projectNextActionScalar(list));
    assert.notEqual(result.next_action, "legacy_scalar");
  });
}
