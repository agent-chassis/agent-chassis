import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { z } from "zod";

import {
  bootstrapRepo,
  validateWorkRecord
} from "../packages/wiki-core/src/index.mjs";
import { registerWikiCoreTools } from "../packages/wiki-mcp/src/lib/wiki-core-tools.mjs";
import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { projectSelectedWorkRecordUnit } from "../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

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
    path: "tests/work-record-compact-read-selected-unit-fields.test.mjs",
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
    path: "tests/work-record-compact-read-selected-unit-fields.test.mjs",
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
  validation: ["node --test tests/work-record-compact-read-selected-unit-fields.test.mjs"],
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
    write_scope: ["tests/work-record-compact-read-selected-unit-fields.test.mjs"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Return the bounded selected-unit contract"],
      validation: ["node --test tests/work-record-compact-read-selected-unit-fields.test.mjs"]
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
    })
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

async function invokeSummary(tools, unit) {
  const tool = tools.get("workspace_work_record_summary");
  assert.ok(tool, "workspace_work_record_summary must be registered");
  const parsed = tool.definition.inputSchema.safeParse({
    unit,
    verbose: true,
    include_full_summary: true,
    accept_full_read: true
  });
  assert.equal(parsed.success, true, "selected-unit arguments must pass the registered schema");
  return tool.handler(parsed.data);
}

async function invokeSelectedRead(tools, toolName, selector) {
  const tool = tools.get(toolName);
  assert.ok(tool, `${toolName} must be registered`);
  const parsed = tool.definition.inputSchema.safeParse({
    ...selector,
    selected_slice: SELECTED_SLICE_ID,
    verbose: true,
    include_record: true,
    include_body: true,
    include_raw: true,
    accept_full_read: true
  });
  assert.equal(parsed.success, true, `${toolName} selected arguments must pass schema`);
  return tool.handler(parsed.data);
}

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
  return [
    await invokeSelectedRead(tools, "workspace_get_record", { id: RECORD_ID }),
    await invokeSelectedRead(tools, "workspace_read_page", {
      path: `wiki/work-records/${RECORD_ID}.json`
    }),
    await invokeSummary(tools, `${RECORD_ID}#${SELECTED_SLICE_ID}`)
  ];
}

async function withFixture(run) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "compact-selected-fields-"));
  try {
    await bootstrapRepo({
      dir: workspaceDir,
      repo: "agent-chassis/compact-read-selected-unit-fields"
    });
    const recordPath = path.join(workspaceDir, "wiki", "work-records", `${RECORD_ID}.json`);
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

test("registered selected-unit summary returns the complete bounded field allowlist", async () => {
  await withFixture(async ({ record, writeRecord, tools }) => {
    const result = await invokeSummary(tools, `${RECORD_ID}#${SELECTED_SLICE_ID}`);

    assert.equal(result.valid, true);
    assert.deepEqual(result.selected_unit, {
      kind: "slice",
      address: `${RECORD_ID}#${SELECTED_SLICE_ID}`,
      record_id: RECORD_ID,
      slice_id: SELECTED_SLICE_ID
    });
    assert.deepEqual(result.summary.depends_on, ["WK-8999#SLICE-001"]);
    assert.deepEqual(result.summary.read_scope, [
      "AGENTS.md",
      "docs/shared.md",
      "docs/legacy.md"
    ]);
    assert.deepEqual(result.summary.expected_edit_targets, expectedEditTargets);
    assert.equal(result.summary.expected_changed_line_budget, 80);
    assert.deepEqual(result.summary.activity_artifact_targets, activityArtifactTargets);
    assert.deepEqual(result.summary.scenarios, scenarios);
    assert.deepEqual(result.summary.expected, expected);
    assert.deepEqual(result.summary.closure, closure);
    assert.deepEqual(result.summary.sections, { agent_notes: "Selected slice notes" });
    assert.deepEqual(Object.keys(result.summary).sort(), [
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
      "validation",
      "work_kind",
      "write_scope"
    ]);

    const getRecordResult = await invokeSelectedRead(tools, "workspace_get_record", {
      id: RECORD_ID
    });
    const readPageResult = await invokeSelectedRead(tools, "workspace_read_page", {
      path: `wiki/work-records/${RECORD_ID}.json`
    });
    assert.deepEqual(
      getRecordResult.selected_slice,
      result.summary,
      "workspace_get_record and workspace_work_record_summary must share one selected-unit contract"
    );
    assert.deepEqual(
      readPageResult.selected_slice,
      result.summary,
      "workspace_read_page and workspace_work_record_summary must share one selected-unit contract"
    );

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

    const legacyDocsResult = await invokeSummary(
      tools,
      `${RECORD_ID}#${LEGACY_DOCS_SLICE_ID}`
    );
    assert.equal(legacyDocsResult.valid, true);
    assert.ok(
      Object.hasOwn(legacyDocsResult.summary, "depends_on"),
      "an authored empty depends_on array must remain present"
    );
    assert.deepEqual(legacyDocsResult.summary.depends_on, []);
    assert.deepEqual(legacyDocsResult.summary.read_scope, ["docs/legacy-only.md"]);
    assert.equal(Object.hasOwn(legacyDocsResult.summary, "docs"), false);

    record.expected = {
      schema_version: "expected-envelope.v1",
      declared_metrics: {},
      [DIAGNOSTIC_SENTINEL]: true
    };
    await writeRecord();
    const invalidParentResult = await invokeSummary(
      tools,
      `${RECORD_ID}#${SELECTED_SLICE_ID}`
    );
    assert.equal(invalidParentResult.valid, false, "the parent fixture must produce diagnostics");
    assert.equal(Object.hasOwn(invalidParentResult, "diagnostics"), false);
    assert.equal(JSON.stringify(invalidParentResult).includes(DIAGNOSTIC_SENTINEL), false);
  });
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
    assert.deepEqual(result.sections, { agent_notes: agentNotes });
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
    assert.deepEqual(result.sections.agent_notes, agentNotes);
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

test("registered selected-unit summary refuses a conflicting nested identity carrier", async () => {
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

    const result = await invokeSummary(tools, `${RECORD_ID}#${SELECTED_SLICE_ID}`);

    assert.ok(result instanceof Error);
    assert.equal(result.name, "WorkRecordSelectedIdentityError");
    assert.equal(result.code, "selected_result_identity_mismatch");
    assert.equal(
      result.envelope.schema_version,
      "work-record-selected-identity-refusal.v1"
    );
    assert.equal(result.envelope.accepted, false);
    const refusalText = JSON.stringify(result.envelope);
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
      const projectedUnits = [results[0].selected_slice, results[1].selected_slice, results[2].summary];
      for (const projected of projectedUnits) {
        assert.equal(projected.title, "");
        assert.equal(projected.priority, "");
        assert.equal(projected.owner, "");
        assert.deepEqual(projected.agent_notes, agentNotes);
        assert.deepEqual(projected.sections.agent_notes, agentNotes);
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
