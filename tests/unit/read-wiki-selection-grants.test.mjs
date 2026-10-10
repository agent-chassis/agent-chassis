

import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_KIND,
  SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION,
  SessionRoleToolAccessPolicyError,
  resolveReadWikiSelectionGrantsFromPolicy,
  resolveRoleToolGrantsFromPolicy,
  resolveToolDispositionsFromPolicy,
  validateSessionRoleToolAccessPolicy
} from "../../packages/wiki-core/src/lib/tool-discovery/gating.mjs";

const ROLES = ["orchestrator", "reviewer", "worker", "redteam", "operator"];

const basePolicy = () => ({
  schema_version: SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION,
  kind: SESSION_ROLE_TOOL_ACCESS_POLICY_KIND,
  roles: [...ROLES],
  access: {
    read_wiki: [...ROLES],
    workspace_search_repo: ["orchestrator", "reviewer", "redteam", "worker", "operator"],
    workspace_read_page: ["worker", "reviewer", "operator"]
  },
  dispositions: { read_wiki: ["direct"], workspace_search_repo: ["direct"], workspace_read_page: ["direct"] }
});
const SELECTIONS = [
  { source_kind: "record", selection: "integrity", roles: ["reviewer"] },
  { source_kind: "document", selection: "integrity", roles: ["operator"] },
  { source_kind: "repository", selection: "integrity", roles: ["operator", "orchestrator"] },
  { source_kind: "assignment", selection: "current", roles: ["worker"] },
  { source_kind: "contract", selection: "assigned", roles: ["worker"] },
  { source_kind: "record", selection: "ordinary", roles: ["orchestrator", "reviewer", "redteam"] },
  { source_kind: "search", selection: "ranked", roles: ["orchestrator", "reviewer"] }
];
const withSelections = (rows = SELECTIONS) => ({ ...basePolicy(), read_selections: structuredClone(rows) });
const resolve = (policy, sourceKind, selection) =>
  [...resolveReadWikiSelectionGrantsFromPolicy(policy, { source_kind: sourceKind, selection })].sort();
const codes = (diagnostics) => diagnostics.map((diagnostic) => diagnostic.code);
const rejects = (code, run) => assert.throws(run, (error) => {
  assert.ok(error instanceof SessionRoleToolAccessPolicyError, String(error?.stack ?? error));
  assert.ok(codes(error.diagnostics).includes(code), `${code} in ${JSON.stringify(codes(error.diagnostics))}`);
  assert.equal(error.code, error.diagnostics[0].code);
  return true;
});

test("RW-P01", () => {
  const policy = withSelections();

  const expected = [
    ["record", "integrity", ["reviewer"]],
    ["document", "integrity", ["operator"]],
    ["repository", "integrity", ["operator", "orchestrator"]],
    ["assignment", "current", ["worker"]],
    ["contract", "assigned", ["worker"]],
    ["record", "ordinary", ["orchestrator", "redteam", "reviewer"]],
    ["search", "ranked", ["orchestrator", "reviewer"]]
  ];
  for (const [sourceKind, selection, roles] of expected) {
    assert.deepEqual(resolve(policy, sourceKind, selection), roles, `${sourceKind}/${selection}`);
  }
  const granted = (role, sourceKind, selection) => resolve(policy, sourceKind, selection).includes(role);

  assert.deepEqual([granted("reviewer", "record", "integrity"), granted("reviewer", "document", "integrity"),
    granted("reviewer", "repository", "integrity")], [true, false, false]);

  assert.deepEqual([granted("worker", "assignment", "current"), granted("worker", "contract", "assigned"),
    granted("worker", "record", "ordinary"), granted("worker", "search", "ranked"),
    granted("worker", "record", "integrity")], [true, true, false, false, false]);

  for (const [sourceKind, selection] of [
    ["record", "integ"], ["record", "integrity-summary"], ["rec", "integrity"], ["records", "integrity"],
    ["Record", "integrity"], ["record", "Integrity"], ["integrity", "record"], ["record", "current"],
    ["assignment", "assigned"], ["contract", "current"], ["search", "ordinary"], ["search", "selected"],
    ["read_wiki", "direct"], ["workspace_search_repo", "ranked"], ["workspace_read_page", "ordinary"],
    ["unknown", "unknown"]
  ]) {
    const roles = resolveReadWikiSelectionGrantsFromPolicy(policy, { source_kind: sourceKind, selection });
    assert.ok(roles instanceof Set);
    assert.deepEqual([...roles], [], `${sourceKind}/${selection} grants no role`);
  }

  assert.ok(resolveRoleToolGrantsFromPolicy(policy).get("worker").has("workspace_search_repo"));
  assert.ok(resolveRoleToolGrantsFromPolicy(policy).get("worker").has("read_wiki"));
});

test("RW-P02", () => {

  assert.deepEqual(validateSessionRoleToolAccessPolicy(basePolicy()), []);
  assert.equal(resolveRoleToolGrantsFromPolicy(basePolicy()).get("worker").size, 3);
  rejects("session_role_policy_missing_read_selections", () => resolve(basePolicy(), "record", "integrity"));
  assert.deepEqual(validateSessionRoleToolAccessPolicy(withSelections()), []);

  const good = { source_kind: "record", selection: "integrity", roles: ["reviewer"] };
  const sectionCases = [
    ["session_role_policy_invalid_read_selections", { record: good }],
    ["session_role_policy_invalid_read_selections", null],
    ["session_role_policy_empty_read_selections", []],
    ["session_role_policy_invalid_read_selection_row", ["record/integrity"]],
    ["session_role_policy_invalid_read_selection_row", [[good]]],
    ["session_role_policy_invalid_read_selection_keys", [{ ...good, repository: "demo" }]],
    ["session_role_policy_invalid_read_selection_keys", [{ source_kind: "record", roles: ["reviewer"] }]],
    ["session_role_policy_invalid_read_selection_identity", [{ ...good, source_kind: "" }]],
    ["session_role_policy_invalid_read_selection_identity", [{ ...good, selection: "   " }]],
    ["session_role_policy_invalid_read_selection_identity", [{ ...good, selection: " integrity" }]],
    ["session_role_policy_invalid_read_selection_identity", [{ ...good, source_kind: 7 }]],
    ["session_role_policy_read_selection_wildcard", [{ ...good, source_kind: "*" }]],
    ["session_role_policy_read_selection_wildcard", [{ ...good, selection: "integrity*" }]],
    ["session_role_policy_read_selection_wildcard", [{ ...good, selection: "integrit?" }]],
    ["session_role_policy_duplicate_read_selection", [good, { ...good, roles: ["worker"] }]],
    ["session_role_policy_invalid_read_selection_roles", [{ ...good, roles: "reviewer" }]],
    ["session_role_policy_empty_read_selection_roles", [{ ...good, roles: [] }]],
    ["session_role_policy_invalid_read_selection_role_entry", [{ ...good, roles: ["reviewer", ""] }]],
    ["session_role_policy_duplicate_read_selection_role", [{ ...good, roles: ["reviewer", "reviewer"] }]],
    ["session_role_policy_undeclared_read_selection_role", [{ ...good, roles: ["auditor"] }]],
    ["session_role_policy_undeclared_read_selection_role", [{ ...good, roles: ["*"] }]]
  ];
  for (const [code, rows] of sectionCases) {
    const policy = { ...basePolicy(), read_selections: rows };
    const diagnostics = validateSessionRoleToolAccessPolicy(policy);
    assert.deepEqual(codes(diagnostics), [code], JSON.stringify(rows));
    assert.ok(diagnostics[0].message.includes("read_selections"), diagnostics[0].message);

    rejects(code, () => resolve(policy, "record", "integrity"));
    rejects(code, () => resolveRoleToolGrantsFromPolicy(policy));
  }

  const policy = withSelections();
  for (const tuple of [
    undefined, null, "record/integrity", ["record", "integrity"], {},
    { source_kind: "record" }, { selection: "integrity" },
    { source_kind: "record", selection: "integrity", role: "reviewer" },
    { source_kind: "record", selection: "integrity", repository: "demo" },
    { source_kind: "record", selection: "integrity", reference: "WK-0001" },
    { source_kind: "", selection: "integrity" }, { source_kind: "record", selection: 3 },
    { source_kind: "record", selection: "integrity " }, { source_kind: "*", selection: "integrity" },
    { source_kind: "record", selection: "*" }, { source_kind: "rec?rd", selection: "integrity" }
  ]) {
    rejects("session_role_policy_invalid_read_selection_tuple",
      () => resolveReadWikiSelectionGrantsFromPolicy(policy, tuple));
  }
});

test("RW-P03", () => {
  const without = basePolicy();
  const policy = withSelections();
  const snapshot = structuredClone(policy);
  const tuple = { source_kind: "repository", selection: "integrity" };
  const tupleSnapshot = structuredClone(tuple);

  const grants = (value) => [...resolveRoleToolGrantsFromPolicy(value)].map(([role, tools]) => [role, [...tools]]);
  assert.deepEqual(grants(policy), grants(without));
  assert.deepEqual(grants(policy).find(([role]) => role === "worker"),
    ["worker", ["read_wiki", "workspace_search_repo", "workspace_read_page"]]);
  assert.deepEqual([...resolveToolDispositionsFromPolicy(policy)], [...resolveToolDispositionsFromPolicy(without)]);
  assert.deepEqual([...resolveToolDispositionsFromPolicy(policy)],
    [["read_wiki", "direct"], ["workspace_search_repo", "direct"], ["workspace_read_page", "direct"]]);

  const first = resolveReadWikiSelectionGrantsFromPolicy(policy, tuple);
  const second = resolveReadWikiSelectionGrantsFromPolicy(policy, tuple);
  assert.notEqual(first, second);
  first.add("worker");
  first.delete("operator");
  second.clear();
  assert.deepEqual(resolve(policy, "repository", "integrity"), ["operator", "orchestrator"]);
  const unknown = resolveReadWikiSelectionGrantsFromPolicy(policy, { source_kind: "unknown", selection: "unknown" });
  unknown.add("operator");
  assert.deepEqual(resolve(policy, "unknown", "unknown"), []);
  assert.deepEqual(resolve(policy, "record", "integrity"), ["reviewer"]);

  assert.throws(() => resolveReadWikiSelectionGrantsFromPolicy(policy, { ...tuple, role: "worker" }),
    SessionRoleToolAccessPolicyError);
  assert.deepEqual(policy, snapshot);
  assert.deepEqual(tuple, tupleSnapshot);
  const frozen = Object.freeze({ ...policy, read_selections: Object.freeze(policy.read_selections.map((row) =>
    Object.freeze({ ...row, roles: Object.freeze([...row.roles]) }))) });
  assert.deepEqual([...resolveReadWikiSelectionGrantsFromPolicy(frozen, Object.freeze({ ...tuple }))].sort(),
    ["operator", "orchestrator"]);
});

test("RW-P04", () => {

  const policy = withSelections([
    { source_kind: "manifest", selection: "context", roles: ["orchestrator", "reviewer", "operator"] },
    { source_kind: "manifest", selection: "field", roles: ["orchestrator", "reviewer", "operator"] },
    { source_kind: "requirement_guidance", selection: "context", roles: ["orchestrator", "operator"] },
    { source_kind: "requirement_guidance", selection: "guidance", roles: ["orchestrator"] }
  ]);
  assert.deepEqual(validateSessionRoleToolAccessPolicy(policy), []);
  assert.deepEqual(resolve(policy, "requirement_guidance", "context"), ["operator", "orchestrator"]);
  assert.deepEqual(resolve(policy, "requirement_guidance", "guidance"), ["orchestrator"]);
  for (const [sourceKind, selection] of [
    ["requirement_guidance", "field"], ["requirement_guidance", "contract"], ["manifest", "guidance"],
    ["requirement", "guidance"], ["requirement_guidance", "Guidance"], ["guidance", "requirement_guidance"],
    ["read_wiki", "guidance"]
  ]) assert.deepEqual(resolve(policy, sourceKind, selection), [], `${sourceKind}/${selection} grants no role`);
  assert.deepEqual(resolve(policy, "manifest", "context"), ["operator", "orchestrator", "reviewer"]);
});
