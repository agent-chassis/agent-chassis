import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { z } from "zod";

import { bootstrapRepo } from "../../packages/wiki-core/src/operations/bootstrap.mjs";
import { validateWorkRecord } from "../../packages/wiki-core/src/lib/work-record-schema.mjs";
import { registerWikiCoreTools } from "../../packages/wiki-mcp/src/lib/wiki-core-tools.mjs";
import { registerWorkRecordReadTools } from "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import {
  projectSelectedWorkRecordUnit
} from "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

const RECORD_ID = "WK-9000";
const SELECTED_SLICE_ID = "SLICE-002";
const LEGACY_DOCS_SLICE_ID = "SLICE-003";
const PARENT_SENTINEL = "PARENT_ONLY_CONTENT";
const SIBLING_SENTINEL = "SIBLING_ONLY_CONTENT";
const RAW_SENTINEL = "RAW_SELECTED_UNIT_CONTENT";
const SIDECAR_SENTINEL = "FULL_SIDECAR_CONTENT";
const DIAGNOSTIC_SENTINEL = "WHOLE_RECORD_DIAGNOSTIC_CONTENT";
const CONTINUATION_SENTINEL = "CONTINUATION_CONTENT";
const UNKNOWN_ANNOTATION_SENTINEL = "UNKNOWN_ANNOTATION_CONTENT";

test("selected-unit projection defaults and round-trips structural review_purpose", () => {
  const base = { id: "SLICE-008", title: "Review", status: "todo", work_kind: "review" };
  assert.equal(projectSelectedWorkRecordUnit(base).review_purpose, "standalone");
  assert.equal(projectSelectedWorkRecordUnit({
    ...base,
    review_purpose: "terminal_whole_wk"
  }).review_purpose, "terminal_whole_wk");
  assert.equal(projectSelectedWorkRecordUnit({
    ...base,
    review_purpose: "unknown"
  }), null);
});

test("core selected-unit projector preserves canonical validation declarations", () => {
  const structured = {
    verification_ids: ["claim-third", "claim-first", "claim-second"],
    operation: "node_test",
    target: "tests/selected.test.mjs"
  };
  Object.defineProperty(structured, "hidden", {
    enumerable: false,
    value: "must-not-project"
  });
  const unit = {
    id: SELECTED_SLICE_ID,
    acceptance: {
      criteria: ["criterion"],
      validation: ["  node --test tests/legacy.test.mjs  ", structured]
    }
  };

  const result = projectSelectedWorkRecordUnit(unit);
  assert.notEqual(result, null);
  const expected = [
    "  node --test tests/legacy.test.mjs  ",
    {
      operation: "node_test",
      target: structured.target,
      verification_ids: ["claim-first", "claim-second", "claim-third"]
    }
  ];
  assert.deepEqual(result.acceptance.validation, expected);
  assert.deepEqual(Object.keys(result.acceptance.validation[1]), [
    "operation",
    "target",
    "verification_ids"
  ]);
  assert.notEqual(result.acceptance.validation, unit.acceptance.validation);
  assert.notEqual(result.acceptance.validation[1], structured);
  assert.notEqual(result.acceptance.validation[1].verification_ids, structured.verification_ids);

  result.acceptance.validation[1].target = "tests/mutated.test.mjs";
  result.acceptance.validation[1].verification_ids.reverse();
  assert.equal(
    structured.target,
    "tests/selected.test.mjs"
  );
  assert.deepEqual(structured.verification_ids, ["claim-third", "claim-first", "claim-second"]);

  const empty = projectSelectedWorkRecordUnit({
    id: SELECTED_SLICE_ID,
    acceptance: { criteria: [], validation: [] }
  });
  assert.deepEqual(empty.acceptance.validation, []);
});

test("core selected-unit projector rejects malformed validation sections without partial output", () => {
  const malformedSections = [
    ["node --test tests/valid.test.mjs", "   "],
    [{ command: "node --test tests/a.test.mjs", verification_ids: [] }],
    [{ command: "node --test tests/a.test.mjs", verification_ids: ["claim-a"], extra: true }],
    [
      { command: "node --test tests/a.test.mjs", verification_ids: ["claim-a"] },
      { command: "node --test tests/b.test.mjs", verification_ids: ["claim-a"] }
    ],
    [42]
  ];
  for (const validation of malformedSections) {
    assert.equal(
      projectSelectedWorkRecordUnit({
        id: SELECTED_SLICE_ID,
        acceptance: { criteria: ["criterion"], validation }
      }),
      null
    );
  }
});

function hostileProxy(target = {}) {
  let trapCount = 0;
  const trap = () => {
    trapCount += 1;
    throw new Error("hostile Proxy trap executed");
  };
  return {
    proxy: new Proxy(target, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap
    }),
    trapCount: () => trapCount
  };
}

const activityArtifactTargets = [
  {
    id: "target-1",
    path: "tests/unit/work-record-compact-read-selected-unit-fields.test.mjs",
    name: "registered handler regression",
    activity_kind: "verification_test_authoring",
    artifact_kind: "regression_test",
    operation: "create",
    granularity: "test_case"
  }
];
const scenarios = [
  {
    id: "scenario-1",
    scenario_kind: "success_case",
    process_boundary: false,
    asserts_contract: "selected-unit projection",
    runtime_mode: "local",
    artifact_kind: "regression_test"
  }
];
const expectedEditTargets = [
  {
    name: "selected-unit field regression",
    path: "tests/unit/work-record-compact-read-selected-unit-fields.test.mjs",
    kind: "test_case",
    operation: "create"
  }
];
const expected = {
  schema_version: "expected-envelope.v1",
  declared_metrics: {
    changed_line_count: 80
  }
};
const closure = {
  summary: "Selected-unit extension closure",
  validation: ["node --test tests/unit/work-record-compact-read-selected-unit-fields.test.mjs"],
  follow_ups: []
};

function selectedSlice() {
  return {
    id: SELECTED_SLICE_ID,
    title: "Selected slice",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "unassigned",
    depends_on: ["WK-8999#SLICE-001"],
    read_scope: ["AGENTS.md", "docs/shared.md"],
    docs: ["docs/legacy.md", "docs/shared.md"],
    repo_paths: ["packages/selected.mjs"],
    write_scope: ["tests/unit/work-record-compact-read-selected-unit-fields.test.mjs"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Return the bounded selected-unit contract"],
      validation: ["node --test tests/unit/work-record-compact-read-selected-unit-fields.test.mjs"]
    },
    expected_edit_targets: expectedEditTargets,
    expected_changed_line_budget: 80,
    activity_artifact_targets: activityArtifactTargets,
    scenarios,
    expected,
    expected_envelope: {
      schema_version: "expected-envelope.v1",
      profile_ref: "legacy-profile-must-not-leak"
    },
    closure,
    sections: {
      agent_notes: "Selected slice notes",
      closure: null,
      raw: RAW_SENTINEL,
      body: RAW_SENTINEL,
      diagnostics: [{ message: DIAGNOSTIC_SENTINEL }],
      continuation: { token: CONTINUATION_SENTINEL },
      arbitrary_extension: UNKNOWN_ANNOTATION_SENTINEL
    },
    raw: RAW_SENTINEL,
    body: RAW_SENTINEL,
    sidecar: { content: SIDECAR_SENTINEL },
    diagnostics: [{ message: DIAGNOSTIC_SENTINEL }],
    continuation: { token: CONTINUATION_SENTINEL },
    annotations: { arbitrary: UNKNOWN_ANNOTATION_SENTINEL }
  };
}

function recordFixture() {
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    repo: "agent-chassis/compact-read-selected-unit-fields",
    title: PARENT_SENTINEL,
    record_kind: "work_item",
    work_kind: "tracker",
    status: "active",
    priority: "high",
    owner: "unassigned",
    initiative: null,
    created: "2026-07-16",
    updated: "2026-07-16",
    resolution: "unresolved",
    read_scope: ["docs/parent-only.md"],
    repo_paths: ["packages/parent-only.mjs"],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [PARENT_SENTINEL],
      validation: []
    },
    sections: {
      summary: PARENT_SENTINEL,
      why_it_matters: PARENT_SENTINEL,
      scope: {
        items: [PARENT_SENTINEL],
        out_of_scope: []
      },
      tasks: [],
      references: [],
      agent_notes: PARENT_SENTINEL,
      closure: null
    },
    children: [],
    slices: [
      {
        id: "SLICE-001",
        title: "Sibling slice",
        work_kind: "implementation",
        status: "todo",
        priority: "high",
        owner: "unassigned",
        depends_on: [],
        read_scope: [],
        repo_paths: ["packages/sibling.mjs"],
        write_scope: ["packages/sibling.mjs"],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: {
          criteria: [SIBLING_SENTINEL],
          validation: []
        },
        sections: { agent_notes: SIBLING_SENTINEL, closure: null }
      },
      selectedSlice(),
      {
        id: LEGACY_DOCS_SLICE_ID,
        title: "Legacy docs and empty dependencies",
        work_kind: "implementation",
        status: "todo",
        priority: "high",
        owner: "unassigned",
        depends_on: [],
        docs: ["docs/legacy-only.md"],
        repo_paths: [],
        write_scope: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: { criteria: [], validation: [] },
        sections: { agent_notes: "Legacy docs slice notes", closure: null }
      }
    ],
    escalations: [],
    projections: [],
    migration: null,
    diagnostics: [{ message: DIAGNOSTIC_SENTINEL }],
    continuation: { token: CONTINUATION_SENTINEL },
    full_sidecar: { content: SIDECAR_SENTINEL }
  };
}

function captureRegisteredTools({ workspaceDir }) {
  const tools = new Map();
  const registration = {
    registerTool(name, definition, handler) {
      tools.set(name, { definition, handler });
    },
    workspaceRepos: { repos: new Map() },
    z,
    jsonContent: (value) => value,
    errorContent: (error) => error,
    resolveWorkspaceRepo: () => ({
      repo: "agent-chassis/compact-read-selected-unit-fields",
      dir: workspaceDir
    }),
    isToolVisible: () => true
  };
  registerWikiCoreTools({
    ...registration,
    emptySchema: {},
    extensionNamespacesSchema: z.array(z.string()).optional(),
    section: "primary"
  });
  registerWorkRecordReadTools({
    ...registration,
    createCompactValidateDispatchResponse: (_repo, value) => value
  });
  return tools;
}

async function invokeTool(tools, toolName, args) {
  const tool = tools.get(toolName);
  assert.ok(tool, `${toolName} must be registered`);
  const parsed = tool.definition.inputSchema.safeParse(args);
  assert.equal(parsed.success, true, `${toolName} arguments must pass the registered schema`);
  return tool.handler(parsed.data);
}

async function invokeSelectedRead(tools, sliceId = SELECTED_SLICE_ID) {
  return invokeTool(tools, "workspace_get_record", { id: RECORD_ID, selected_slice: sliceId });
}

const RETIRED_WIDENING_FLAGS = [
  { verbose: true }, { include_record: true }, { include_raw: true },
  { include_full_summary: true }, { accept_full_read: true }, { compact_read_token: "e30" }
];

function assertBoundedIdentityRefusal(result, label = "selected handler") {
  assert.ok(result instanceof Error, `${label} must return an Error`);
  assert.equal(result.name, "WorkRecordSelectedIdentityError");
  assert.equal(result.code, "selected_result_identity_mismatch");
  const refusalText = JSON.stringify(result.envelope);
  for (const forbidden of [
    PARENT_SENTINEL,
    SIBLING_SENTINEL,
    RAW_SENTINEL,
    SIDECAR_SENTINEL,
    DIAGNOSTIC_SENTINEL,
    CONTINUATION_SENTINEL
  ]) {
    assert.equal(refusalText.includes(forbidden), false, `refusal must exclude ${forbidden}`);
  }
}

async function invokeAllSelectedHandlers(tools) {
  return [await invokeSelectedRead(tools)];
}

async function withFixture(run) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "compact-selected-fields-"));
  try {
    await bootstrapRepo({
      dir: workspaceDir,
      repo: "agent-chassis/compact-read-selected-unit-fields"
    });
    const recordPath = path.join(workspaceDir, "wiki", "work-records", `${RECORD_ID}.json`);
    await mkdir(path.dirname(recordPath), { recursive: true });
    const record = recordFixture();
    assert.deepEqual(
      validateWorkRecord(record, { sourcePath: `wiki/work-records/${RECORD_ID}.json` }),
      [],
      "the registered-handler fixture must be a valid canonical work record"
    );
    const writeRecord = () => writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await writeRecord();
    await run({
      record,
      writeRecord,
      tools: captureRegisteredTools({ workspaceDir })
    });
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

test("registered selected-slice read returns the complete bounded field allowlist", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const result = await invokeSelectedRead(tools);

    assert.equal(result.valid, true);
    assert.equal(result.record_id, RECORD_ID);
    assert.equal(result.selected_slice_id, SELECTED_SLICE_ID);
    assert.equal(result.selected_slice_found, true);
    const projected = result.selected_slice;
    assert.deepEqual(projected.depends_on, ["WK-8999#SLICE-001"]);
    assert.deepEqual(projected.read_scope, [
      "AGENTS.md",
      "docs/shared.md",
      "docs/legacy.md"
    ]);
    assert.deepEqual(projected.expected_edit_targets, expectedEditTargets);
    assert.equal(projected.expected_changed_line_budget, 80);
    assert.deepEqual(projected.activity_artifact_targets, activityArtifactTargets);
    assert.deepEqual(projected.scenarios, scenarios);
    assert.deepEqual(projected.expected, expected);
    assert.deepEqual(projected.closure, closure);
    assert.deepEqual(projected.sections, {});
    assert.deepEqual(Object.keys(projected).sort(), [
      "acceptance",
      "activity_artifact_targets",
      "agent_notes",
      "closure",
      "depends_on",
      "dispatch_intent",
      "expected",
      "expected_changed_line_budget",
      "expected_edit_targets",
      "id",
      "owner",
      "priority",
      "read_scope",
      "repo_paths",
      "scenarios",
      "sections",
      "status",
      "title",
      "work_kind",
      "write_scope"
    ]);

    const selectedSliceKeys = Object.keys(record.slices.find((slice) => slice.id === SELECTED_SLICE_ID));
    const memberPages = [
      await invokeTool(tools, "workspace_get_record",
        { id: RECORD_ID, selected_slice: SELECTED_SLICE_ID, member: { path: [] } }),
      await invokeTool(tools, "workspace_read_page",
        { path: `wiki/work-records/${RECORD_ID}.json`, selected_slice: SELECTED_SLICE_ID, member: { path: [] } }),
      await invokeTool(tools, "workspace_work_record_summary",
        { unit: `${RECORD_ID}#${SELECTED_SLICE_ID}`, member: { path: [] } })
    ];
    for (const page of memberPages) {
      assert.equal(page.ok, true, JSON.stringify(page));
      assert.equal(page.record_id, RECORD_ID);
      assert.equal(page.selected_slice, SELECTED_SLICE_ID);
      assert.deepEqual(page.member.path, []);
      assert.equal(page.member.total_count, selectedSliceKeys.length);
      assert.deepEqual(page.member.members.map((row) => row.key),
        selectedSliceKeys.slice(0, page.member.returned_count));
      assert.deepEqual(page.member.members, memberPages[0].member.members);
      const pageText = JSON.stringify(page);
      for (const forbidden of [PARENT_SENTINEL, SIBLING_SENTINEL, RAW_SENTINEL, SIDECAR_SENTINEL,
        DIAGNOSTIC_SENTINEL, CONTINUATION_SENTINEL, UNKNOWN_ANNOTATION_SENTINEL]) {
        assert.equal(pageText.includes(forbidden), false, `member page must exclude ${forbidden}`);
      }
    }
    for (const flags of RETIRED_WIDENING_FLAGS) {
      const schema = tools.get("workspace_get_record").definition.inputSchema;
      assert.equal(schema.safeParse({ id: RECORD_ID, selected_slice: SELECTED_SLICE_ID, ...flags }).success, false,
        `retired ${Object.keys(flags)[0]} is schema-invalid`);
    }

    const text = JSON.stringify(result);
    for (const forbidden of [
      PARENT_SENTINEL,
      SIBLING_SENTINEL,
      RAW_SENTINEL,
      SIDECAR_SENTINEL,
      DIAGNOSTIC_SENTINEL,
      CONTINUATION_SENTINEL,
      UNKNOWN_ANNOTATION_SENTINEL,
      "legacy-profile-must-not-leak",
      '"expected_envelope"',
      '"raw"',
      '"body"',
      '"sidecar"',
      '"diagnostics"',
      '"continuation"',
      '"compact_read"',
      '"next_calls"'
    ]) {
      assert.equal(text.includes(forbidden), false, `selected summary must exclude ${forbidden}`);
    }

    const legacyDocsResult = await invokeSelectedRead(tools, LEGACY_DOCS_SLICE_ID);
    assert.equal(legacyDocsResult.valid, true);
    assert.ok(
      Object.hasOwn(legacyDocsResult.selected_slice, "depends_on"),
      "an authored empty depends_on array must remain present"
    );
    assert.deepEqual(legacyDocsResult.selected_slice.depends_on, []);
    assert.deepEqual(legacyDocsResult.selected_slice.read_scope, ["docs/legacy-only.md"]);
    assert.equal(Object.hasOwn(legacyDocsResult.selected_slice, "docs"), false);

    record.expected = {
      schema_version: "expected-envelope.v1",
      declared_metrics: {},
      [DIAGNOSTIC_SENTINEL]: true
    };
    await writeRecord();
    const invalidParentResult = await invokeSelectedRead(tools);
    assert.equal(invalidParentResult.valid, false, "the parent fixture must produce diagnostics");
    assert.equal(Object.hasOwn(invalidParentResult, "diagnostics"), false);
    assert.equal(JSON.stringify(invalidParentResult).includes(DIAGNOSTIC_SENTINEL), false);
  });
});

test("root summary names the enumeration that reaches withheld slices and they round-trip through the same gate", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const visible = { ...selectedSlice(), status: "todo" };
    record.slices = [
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `SLICE-${String(index + 10).padStart(3, "0")}`,
        title: `Completed hidden slice ${index + 1}`,
        work_kind: "implementation",
        status: "done",
        priority: "medium",
        owner: "unassigned",
        depends_on: [],
        read_scope: ["AGENTS.md"],
        repo_paths: ["packages/completed.mjs"],
        write_scope: ["packages/completed.mjs"],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: { criteria: ["Completed"], validation: [] },
        sections: { agent_notes: "hidden", closure }
      })),
      visible
    ];
    await writeRecord();

    const tool = tools.get("workspace_work_record_summary");
    const call = (args) => tool.handler(tool.definition.inputSchema.parse(args));
    const rootResult = await call({ id: RECORD_ID });

    assert.equal(rootResult.ok, true);
    assert.equal(Object.hasOwn(rootResult, "slices"), false, "the lean default lists no slice rows");
    const enumeration = rootResult.next_calls.find(({ arguments: arguments_ }) =>
      Object.hasOwn(arguments_, "slice_offset"));
    assert.ok(enumeration, "a record with slices names the bounded enumeration");
    assert.equal(enumeration.tool, "workspace_work_record_summary");

    const page = await call(enumeration.arguments);
    const pageIds = page.slice_page.slices.map((slice) => slice.id);
    assert.deepEqual(pageIds, record.slices.map((slice) => slice.id));
    const withheldSliceId = pageIds[0];
    assert.notEqual(withheldSliceId, SELECTED_SLICE_ID, "a completed slice is reachable too");

    assert.throws(() => call({ unit: `${RECORD_ID}#${withheldSliceId}`, accept_full_read: true }));
    const selectedResult = await invokeSelectedRead(tools, withheldSliceId);
    assert.equal(selectedResult.valid, true);
    assert.equal(selectedResult.selected_slice_id, withheldSliceId);
    assert.equal(selectedResult.selected_slice.id, withheldSliceId);
    const members = await call({ unit: `${RECORD_ID}#${withheldSliceId}`, member: { path: ["id"] } });
    assert.equal(members.ok, true);
    assert.equal(members.selected_slice, withheldSliceId);
    assert.deepEqual(members.member, { path: ["id"], kind: "string", offset: 0, length: withheldSliceId.length,
      total: withheldSliceId.length, value: withheldSliceId });
  });
});

test("selected_record returns the record-level contract fields within the compact size class", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    record.write_scope = ["packages/wiki-mcp/src/lib/example.mjs"];
    record.acceptance = {
      criteria: ["The record-level criterion"],
      validation: ["node --test tests/example.test.mjs"]
    };
    record.slices = Array.from({ length: 43 }, (unused, index) => ({
      id: `SLICE-${String(index + 1).padStart(3, "0")}`,
      title: `Slice ${index + 1}`,
      work_kind: "implementation",
      status: "done",
      priority: "medium",
      owner: "unassigned",
      depends_on: [],
      read_scope: ["AGENTS.md"],
      repo_paths: ["packages/completed.mjs"],
      write_scope: ["packages/completed.mjs"],
      dispatch_intent: {
        intended_agent_role: "worker",
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: { criteria: ["Completed"], validation: [] },
      sections: { agent_notes: `SLICE_BODY_${index}`, closure }
    }));
    await writeRecord();

    const tool = tools.get("workspace_work_record_summary");
    const result = await tool.handler(
      tool.definition.inputSchema.parse({ id: RECORD_ID, selected_record: true })
    );

    assert.equal(result.valid, true);
    assert.equal(result.selected_record, true);
    assert.deepEqual(result.summary.write_scope, ["packages/wiki-mcp/src/lib/example.mjs"]);
    assert.deepEqual(result.summary.acceptance, {
      criteria: ["The record-level criterion"],
      validation: ["node --test tests/example.test.mjs"]
    });
    assert.deepEqual(result.summary.validation, ["node --test tests/example.test.mjs"]);

    const serialized = JSON.stringify(result);
    assert.equal(Object.hasOwn(result.summary, "slices"), false);
    assert.equal(serialized.includes("SLICE_BODY_"), false);
    assert.ok(
      Buffer.byteLength(serialized, "utf8") < 8192,
      `selected_record must stay in the compact size class: ${Buffer.byteLength(serialized, "utf8")} bytes`
    );
  });
});

test("selected_record fits an oversized contract to the compact class and discloses the fit", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const hugeCriterion = `Oversized criterion. ${"detail ".repeat(3000)}`;
    record.write_scope = Array.from(
      { length: 400 },
      (unused, index) => `packages/wiki-mcp/src/lib/oversized-${index}.mjs`
    );
    record.acceptance = {
      criteria: [hugeCriterion, "The second criterion"],
      validation: ["node --test tests/example.test.mjs"]
    };
    await writeRecord();

    const tool = tools.get("workspace_work_record_summary");
    const result = await tool.handler(
      tool.definition.inputSchema.parse({ id: RECORD_ID, selected_record: true })
    );

    const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    assert.ok(
      bytes < 8192,
      `an oversized contract must still land in the compact class: ${bytes} bytes`
    );
    assert.equal(result.response_size.class, "small");
    assert.ok(result.response_size.bytes > 0);

    assert.equal(result.summary.truncated, true);
    assert.equal(result.summary.truncation.reason, "compact_response_size_class");
    assert.equal(result.summary.truncation.fields.acceptance_criteria.total, 2);
    assert.equal(result.summary.truncation.fields.acceptance_criteria.entries_shortened, 1);
    assert.equal(result.summary.truncation.fields.write_scope.total, 400);
    assert.ok(result.summary.truncation.fields.write_scope.omitted_count > 0);
    assert.equal(
      result.summary.truncation.fields.write_scope.returned +
        result.summary.truncation.fields.write_scope.omitted_count,
      400
    );
    assert.equal(result.summary.write_scope.length, result.summary.truncation.fields.write_scope.returned);
    assert.ok(result.summary.acceptance.criteria[0].length < hugeCriterion.length);
    assert.ok(result.summary.acceptance.criteria[0].endsWith("..."));

    assert.equal(Object.hasOwn(result.summary, "slices"), false);
  });
});

test("selected_record returns an unfitted contract whole and reports its size", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    record.write_scope = ["packages/wiki-mcp/src/lib/example.mjs"];
    record.acceptance = {
      criteria: ["The record-level criterion"],
      validation: ["node --test tests/example.test.mjs"]
    };
    await writeRecord();

    const tool = tools.get("workspace_work_record_summary");
    const result = await tool.handler(
      tool.definition.inputSchema.parse({ id: RECORD_ID, selected_record: true })
    );

    assert.equal(result.summary.truncated, false);
    assert.equal(result.summary.truncation, null);
    assert.deepEqual(result.summary.acceptance.criteria, ["The record-level criterion"]);
    assert.equal(result.response_size.class, "small");
  });
});

test("the summary family accepts selected_record and still refuses selected_slice", () => {
  const tools = captureRegisteredTools({ workspaceDir: "/repo" });
  const schema = tools.get("workspace_work_record_summary").definition.inputSchema;

  assert.equal(schema.parse({ id: RECORD_ID, selected_record: true }).selected_record, true);

  assert.throws(() => schema.parse({ id: RECORD_ID, selected_slice: "SLICE-001" }));
  assert.throws(() => schema.parse({ id: RECORD_ID, selected_record: false }));
});

test("core selected-unit projector preserves only authored sections.agent_notes", () => {
  for (const agentNotes of ["", []]) {
    const result = projectSelectedWorkRecordUnit({
      id: SELECTED_SLICE_ID,
      agent_notes: agentNotes,
      sections: {
        agent_notes: agentNotes,
        raw: RAW_SENTINEL,
        body: RAW_SENTINEL,
        diagnostics: [{ message: DIAGNOSTIC_SENTINEL }],
        continuation: { token: CONTINUATION_SENTINEL },
        identity_like_extension: UNKNOWN_ANNOTATION_SENTINEL
      }
    });
    assert.deepEqual(result.sections, {});
    assert.deepEqual(result.agent_notes, agentNotes);
  }
});

test("core selected-unit projector enforces canonical scalar, budget, and note types", () => {
  const canonical = {
    id: SELECTED_SLICE_ID,
    title: "Selected slice",
    status: "active",
    priority: "high",
    owner: "unassigned",
    work_kind: "implementation"
  };
  for (const [agentNotes, budget] of [["", null], [[], 0], [["one", "two"], 120]]) {
    const result = projectSelectedWorkRecordUnit({
      ...canonical,
      agent_notes: agentNotes,
      sections: { agent_notes: agentNotes },
      expected_changed_line_budget: budget
    });
    assert.notEqual(result, null);
    assert.deepEqual(result.agent_notes, agentNotes);
    assert.deepEqual(result.sections, {});
    assert.equal(result.expected_changed_line_budget, budget);
  }

  const canonicalEmptyStrings = projectSelectedWorkRecordUnit({
    ...canonical,
    title: "",
    priority: "",
    owner: ""
  });
  assert.notEqual(canonicalEmptyStrings, null);
  assert.equal(canonicalEmptyStrings.title, "");
  assert.equal(canonicalEmptyStrings.priority, "");
  assert.equal(canonicalEmptyStrings.owner, "");

  for (const [field, value] of [
    ["id", {}],
    ["title", []],
    ["status", {}],
    ["priority", []],
    ["owner", {}],
    ["work_kind", []],
    ["expected_changed_line_budget", {}],
    ["expected_changed_line_budget", -1],
    ["expected_changed_line_budget", 1.5],
    ["agent_notes", {}]
  ]) {
    assert.equal(
      projectSelectedWorkRecordUnit({ ...canonical, [field]: value }),
      null,
      `${field} must reject malformed ${Array.isArray(value) ? "array" : typeof value} values`
    );
  }
  assert.equal(
    projectSelectedWorkRecordUnit({ ...canonical, sections: { agent_notes: ["valid", 2] } }),
    null
  );
});

test("core selected-unit projector rejects cycles and accessors without callbacks", () => {
  let getterCalls = 0;
  let serializerCalls = 0;
  let iteratorCalls = 0;
  const withGetter = { id: SELECTED_SLICE_ID };
  Object.defineProperty(withGetter, "title", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "Selected slice";
    }
  });
  const cyclic = { id: SELECTED_SLICE_ID, expected: {} };
  cyclic.expected.self = cyclic.expected;
  const withSerializer = {
    id: SELECTED_SLICE_ID,
    expected: {
      toJSON() {
        serializerCalls += 1;
        return {};
      }
    }
  };
  const notes = ["one", "two"];
  notes[Symbol.iterator] = function iterator() {
    iteratorCalls += 1;
    return Array.prototype[Symbol.iterator].call(this);
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(projectSelectedWorkRecordUnit(withGetter), null);
    assert.equal(projectSelectedWorkRecordUnit(cyclic), null);
    assert.equal(projectSelectedWorkRecordUnit(withSerializer), null);
    assert.deepEqual(
      projectSelectedWorkRecordUnit({ id: SELECTED_SLICE_ID, agent_notes: notes }).agent_notes,
      ["one", "two"]
    );
  }
  assert.equal(getterCalls, 0);
  assert.equal(serializerCalls, 0);
  assert.equal(iteratorCalls, 0);
});

test("core selected-unit projector rejects hostile Proxies without executing traps", () => {
  const cases = [
    () => hostileProxy({ id: SELECTED_SLICE_ID }),
    () => {
      const hostile = hostileProxy({ agent_notes: "notes" });
      return { value: { id: SELECTED_SLICE_ID, sections: hostile.proxy }, ...hostile };
    },
    () => {
      const hostile = hostileProxy({ declared_metrics: {} });
      return { value: { id: SELECTED_SLICE_ID, expected: hostile.proxy }, ...hostile };
    },
    () => {
      const hostile = hostileProxy([]);
      return {
        value: { id: SELECTED_SLICE_ID, sections: { agent_notes: hostile.proxy } },
        ...hostile
      };
    }
  ];

  for (const buildCase of cases) {
    const built = buildCase();
    const value = built.value ?? built.proxy;
    assert.equal(projectSelectedWorkRecordUnit(value), null);
    assert.equal(projectSelectedWorkRecordUnit(value), null);
    assert.equal(built.trapCount(), 0);
  }
});

test("registered selected-slice projection refuses a conflicting nested identity carrier", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const selected = record.slices.find((slice) => slice.id === SELECTED_SLICE_ID);
    selected.sections.identity = {
      kind: "slice",
      address: `${RECORD_ID}#SLICE-001`,
      record_id: RECORD_ID,
      slice_id: "SLICE-001",
      selected_slice_id: "SLICE-001"
    };
    await writeRecord();

    const result = await invokeSelectedRead(tools);

    assert.equal(result instanceof Error, false, JSON.stringify(result));
    assert.equal(result.selected_slice_id, SELECTED_SLICE_ID);
    assert.deepEqual(result.selected_slice.sections, {});
    assert.equal(JSON.stringify(result).includes(`${RECORD_ID}#SLICE-001`), false,
      "the conflicting identity carrier is not disclosed");
    const refusalText = JSON.stringify(result);
    for (const forbidden of [
      PARENT_SENTINEL,
      SIBLING_SENTINEL,
      RAW_SENTINEL,
      DIAGNOSTIC_SENTINEL,
      CONTINUATION_SENTINEL,
      SIDECAR_SENTINEL
    ]) {
      assert.equal(refusalText.includes(forbidden), false);
    }
  });
});

test("all registered selected-unit handlers refuse nested note, budget, and scalar containers", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const selectedIndex = record.slices.findIndex((slice) => slice.id === SELECTED_SLICE_ID);
    const cases = [
      (slice) => {
        slice.agent_notes = {
          nested: { record_id: "WK-9001" },
          raw: RAW_SENTINEL
        };
      },
      (slice) => {
        slice.expected_changed_line_budget = {
          identity: {
            kind: "slice",
            address: "WK-9001#SLICE-003",
            record_id: "WK-9001",
            slice_id: "SLICE-003"
          },
          diagnostics: DIAGNOSTIC_SENTINEL
        };
      },
      (slice) => {
        slice.agent_notes = ["valid", 2];
      },
      (slice) => {
        slice.sections.agent_notes = ["valid", 2];
      }
    ];

    for (const field of ["title", "status", "priority", "owner", "work_kind"]) {
      cases.push((slice) => {
        slice[field] = { harmless_container_without_identity: true };
      });
    }

    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const mutate = cases[caseIndex];
      const selected = selectedSlice();
      mutate(selected);
      record.slices[selectedIndex] = selected;
      await writeRecord();
      const results = await invokeAllSelectedHandlers(tools);
      for (let handlerIndex = 0; handlerIndex < results.length; handlerIndex += 1) {
        assertBoundedIdentityRefusal(results[handlerIndex], `case ${caseIndex} handler ${handlerIndex}`);
      }
    }

    for (const [agentNotes, budget] of [["", null], [[], 0]]) {
      const selected = selectedSlice();
      selected.title = "";
      selected.priority = "";
      selected.owner = "";
      selected.agent_notes = agentNotes;
      selected.sections.agent_notes = agentNotes;
      selected.expected_changed_line_budget = budget;
      record.slices[selectedIndex] = selected;
      await writeRecord();

      const results = await invokeAllSelectedHandlers(tools);
      const projectedUnits = results.map((result) => result.selected_slice);
      for (const projected of projectedUnits) {
        assert.equal(projected.title, "");
        assert.equal(projected.priority, "");
        assert.equal(projected.owner, "");
        assert.deepEqual(projected.agent_notes, agentNotes);
        assert.deepEqual(projected.sections, {});
        assert.equal(projected.expected_changed_line_budget, budget);
      }
    }
  });
});

test("all registered selected-unit handlers require exact nested path identity carriers", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const selectedIndex = record.slices.findIndex((slice) => slice.id === SELECTED_SLICE_ID);
    const canonicalPath = `wiki/work-records/${RECORD_ID}.json`;

    const canonicalSelected = selectedSlice();
    canonicalSelected.expected = {
      relativePath: canonicalPath,
      source_path_relative: canonicalPath
    };
    record.slices[selectedIndex] = canonicalSelected;
    await writeRecord();
    const canonicalResults = await invokeAllSelectedHandlers(tools);
    for (const result of canonicalResults) {
      const projected = result.selected_slice ?? result.summary;
      assert.deepEqual(projected.expected, {
        relativePath: canonicalPath,
        source_path_relative: canonicalPath
      });
    }

    for (const [field, malformedPath] of [
      ["relativePath", ` ${canonicalPath}`],
      ["relativePath", `${canonicalPath} `],
      ["source_path_relative", ` ${canonicalPath} `]
    ]) {
      const malformedSelected = selectedSlice();
      malformedSelected.expected = {
        [field]: malformedPath,
        malformed_payload: RAW_SENTINEL
      };
      record.slices[selectedIndex] = malformedSelected;
      await writeRecord();

      const results = await invokeAllSelectedHandlers(tools);
      for (let handlerIndex = 0; handlerIndex < results.length; handlerIndex += 1) {
        assertBoundedIdentityRefusal(
          results[handlerIndex],
          `${field} whitespace case handler ${handlerIndex}`
        );
        assert.equal(
          JSON.stringify(results[handlerIndex].envelope).includes(malformedPath),
          false,
          "the bounded refusal must not disclose the malformed path carrier"
        );
      }
    }
  });
});
