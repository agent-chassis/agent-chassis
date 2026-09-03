import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME,
  TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH,
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS,
  TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
  TOOL_DISCOVERY_MANIFEST_PATH,
  TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH,
  TOOL_DISCOVERY_SCHEMA_VERSION,
  compactToolDiscoveryEntry,
  createToolDiscoveryEnvelope,
  digestToolDiscoveryDescriptor,
  isToolDiscoveryFragmentManifest,
  loadToolDiscoveryDescriptor,
  loadToolDiscoveryEnvelope,
  projectToolDiscoveryEntryForTier,
  queryToolDiscoveryDescriptor,
  rankToolDiscoveryTools,
  resolveToolTierVisibility,
  tierVisibilityAllows,
  validateToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const PAID_ONLY_TOOL_NAMES = [
  "workspace_node_engine_admission_runtime_diagnostic",
  "workspace_record_graph_impact_evidence",
  "workspace_work_record_refresh_admission_metrics",
  "workspace_work_record_refresh_target_resolution_evidence",
  "workspace_code_index_impact_paths",
  "workspace_code_index_graph_impact_paths"
];

const PAID_PROSE_TOKENS = [
  "blast-radius",
  "blast_radius",
  "cluster count",
  "cluster_count",
  "multicluster",
  "graph-impact",
  "graph_impact",
  "target-resolution",
  "admission metric",
  "worker_admission",
  "worker-admission"
];

const TARGET_RESOLUTION_TOOL_NAME = "workspace_work_record_refresh_target_resolution_evidence";
const LAUNCHER_GUIDANCE_FIELD_NAMES = [
  "use_when",
  "do_not_use_when",
  "authoritative_for",
  "recommended_first_call",
  "requires_prior_state",
  "replacement_for_misuse"
];

const WK_2437_CONTROLLED_TASK_IDS = Object.freeze([
  "acceptance-gap-review",
  "mapping-repair",
  "obligation-inventory",
  "proof-obligation-map-inspection"
]);

function makeFullDescriptorTool(tool_name, overrides = {}) {
  return {
    tool_name,
    display_name: `Fixture ${tool_name}`,
    kind: "cli_command",
    entrypoint: `npm run wiki -- ${tool_name} --json`,
    task_ids: ["read-canonical"],
    install_state: "installed",
    runtime_posture: "supported",
    recommended_route: "cli",
    priority: 10,
    side_effects: ["read_only"],
    authority: ["workspace_repo"],

    tier_visibility: ["free_local"],
    docs_refs: ["docs/tool-discovery.md"],
    source_files: ["packages/wiki-cli/src/run.mjs"],
    ...overrides
  };
}

function makeFullDescriptor(tools, overrides = {}) {
  return {
    schema_version: TOOL_DISCOVERY_SCHEMA_VERSION,
    repository: "fixture/tool-discovery",
    tools,
    ...overrides
  };
}

async function writeFullDescriptorFixture(descriptor, { filename = TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tool-discovery-descriptor-"));
  const descriptorPath = path.join(tempDir, filename);
  await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2));
  return { tempDir, descriptorPath };
}

test("tool discovery descriptor keeps task ids controlled and target-resolution refresh metadata fresh", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);

  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));

  const controlledTaskIds = new Set(TOOL_DISCOVERY_CONTROLLED_TASK_IDS);
  const uncontrolledTaskIds = descriptor.tools.flatMap((tool) =>
    tool.task_ids.flatMap((taskId) =>
      controlledTaskIds.has(taskId) ? [] : [`${tool.tool_name}:${taskId}`]
    )
  );

  assert.deepEqual(uncontrolledTaskIds, []);

  const targetResolutionTool = descriptor.tools.find(
    (tool) => tool.tool_name === TARGET_RESOLUTION_TOOL_NAME
  );
  assert.ok(targetResolutionTool, "expected target-resolution refresh metadata in the descriptor");
  assert.deepEqual(targetResolutionTool.task_ids, ["refresh-derived-evidence"]);

  const rankedTools = queryToolDiscoveryDescriptor(descriptor, {
    task_id: "refresh-derived-evidence"
  });
  assert.ok(
    rankedTools.some((tool) => tool.tool_name === TARGET_RESOLUTION_TOOL_NAME),
    "target-resolution refresh metadata should be discoverable through the approved task id"
  );

  const envelope = createToolDiscoveryEnvelope({
    interface: "mcp",
    source_kind: "runtime_snapshot",
    descriptor,
    query: { task_id: "refresh-derived-evidence" }
  });

  assert.equal(envelope.freshness.state, "fresh");
  assert.equal(envelope.freshness.degraded, false);
  assert.deepEqual(envelope.freshness.reasons, []);
  assert.deepEqual(
    envelope.diagnostics.filter((entry) => entry.code === "invalid_task_id"),
    [],
    "workspace_tools_describe-equivalent validation should not report invalid_task_id"
  );
  assert.ok(
    envelope.results.some((tool) => tool.tool_name === TARGET_RESOLUTION_TOOL_NAME),
    "descriptor envelope should surface the target-resolution refresh tool"
  );
});

test("WK-2437 task-directed coverage intents are controlled and validate on both describe rows", async () => {
  const controlledTaskIds = new Set(TOOL_DISCOVERY_CONTROLLED_TASK_IDS);
  for (const taskId of WK_2437_CONTROLLED_TASK_IDS) {
    assert.equal(controlledTaskIds.has(taskId), true, `${taskId} must remain controlled`);
  }

  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  assert.deepEqual(validation.diagnostics.filter(({ code }) => code === "invalid_task_id"), []);

  const expectedRows = new Map([
    ["workspace_controlled_contract_acceptance_coverage_describe", [
      "controlled-contract-authoring",
      "acceptance-gap-review",
      "mapping-repair"
    ]],
    ["workspace_controlled_contract_obligation_coverage_describe", [
      "controlled-contract-authoring",
      "obligation-inventory",
      "proof-obligation-map-inspection"
    ]]
  ]);
  for (const [toolName, expectedTaskIds] of expectedRows) {
    const row = descriptor.tools.find(({ tool_name: candidate }) => candidate === toolName);
    assert.ok(row, `${toolName} must remain in the assembled descriptor`);
    assert.deepEqual(row.task_ids, expectedTaskIds);
    for (const taskId of expectedTaskIds) {
      assert.equal(controlledTaskIds.has(taskId), true, `${toolName}:${taskId}`);
    }
  }
});

test("terminal-candidate task ids validate fresh and preserve launcher metadata", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  assert.deepEqual(validation.diagnostics.filter(({ code }) => code === "invalid_task_id"), []);

  for (const expected of [
    {
      taskId: "query-terminal-review-candidate",
      toolName: "workspace_terminal_review_candidate_status",
      sideEffects: ["read_only"]
    },
    {
      taskId: "advance-terminal-review-candidate",
      toolName: "workspace_terminal_review_candidate_advance",
      sideEffects: ["workspace_write"]
    }
  ]) {
    const results = queryToolDiscoveryDescriptor(
      descriptor,
      { task_id: expected.taskId },
      { verbose: true }
    );
    const tool = results.find(({ tool_name: toolName }) => toolName === expected.toolName);
    assert.ok(tool, expected.taskId);
    assert.deepEqual(tool.side_effects, expected.sideEffects);
    assert.deepEqual(tool.authority, ["launcher_registry", "workspace_repo", "launcher_backend"]);
    assert.equal(tool.runtime_posture, "supported");
  }

  const unknown = makeFullDescriptor([
    makeFullDescriptorTool("unknown-terminal-task", {
      task_ids: ["query-terminal-review-candidate-unknown"]
    })
  ]);
  assert.ok(validateToolDiscoveryDescriptor(unknown).diagnostics.some(
    ({ code, task_ids: taskIds }) => code === "invalid_task_id" &&
      taskIds.includes("query-terminal-review-candidate-unknown")
  ));
});

test("default descriptor source is the fragment manifest, never the legacy aggregate", async () => {

  assert.equal(TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH, TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH);
  assert.match(TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH, /tool-discovery\/manifest\.json$/);
  assert.notEqual(
    TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
    TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_RELATIVE_PATH,
    "the default descriptor path must not point at the legacy single-file aggregate"
  );

  const defaultEnvelope = await loadToolDiscoveryEnvelope({ verbose: true });
  assert.equal(defaultEnvelope.descriptor.path, TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH);
  assert.match(defaultEnvelope.descriptor.digest, /^sha256:[0-9a-f]{64}$/);
});

test("explicit descriptorPath loads a full single-file descriptor fixture as-is", async () => {
  const fixture = makeFullDescriptor([
    makeFullDescriptorTool("fixture-alpha", { task_ids: ["read-canonical"] }),
    makeFullDescriptorTool("fixture-bravo", {
      entrypoint: "npm run wiki -- fixture-bravo --json",
      task_ids: ["search-wiki"]
    })
  ]);
  const { tempDir, descriptorPath } = await writeFullDescriptorFixture(fixture);

  try {

    assert.equal(path.basename(descriptorPath), TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME);

    const loaded = await loadToolDiscoveryDescriptor(descriptorPath);
    assert.equal(
      isToolDiscoveryFragmentManifest(loaded),
      false,
      "a full single-file descriptor must not be detected as a fragment manifest"
    );

    assert.deepEqual(loaded, fixture);
    assert.deepEqual(
      loaded.tools.map((tool) => tool.tool_name),
      ["fixture-alpha", "fixture-bravo"]
    );

    const validation = validateToolDiscoveryDescriptor(loaded);
    assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("explicit full-descriptor fixture is distinct from the default assembled corpus", async () => {
  const fixture = makeFullDescriptor([makeFullDescriptorTool("fixture-only")]);
  const { tempDir, descriptorPath } = await writeFullDescriptorFixture(fixture);

  try {
    const explicit = await loadToolDiscoveryDescriptor(descriptorPath);
    const fromDefault = await loadToolDiscoveryDescriptor();

    assert.equal(explicit.tools.length, 1);
    assert.ok(
      fromDefault.tools.length > explicit.tools.length,
      "the default assembled corpus should be larger than the single-tool fixture"
    );
    assert.equal(explicit.repository, "fixture/tool-discovery");
    assert.notEqual(
      fromDefault.repository,
      explicit.repository,
      "the default corpus repository should not match the fixture repository"
    );
    assert.notEqual(
      digestToolDiscoveryDescriptor(explicit),
      digestToolDiscoveryDescriptor(fromDefault),
      "explicit fixture and default corpus digests must differ"
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("explicit descriptorPath pointing at the package manifest assembles like the default", async () => {

  const fromDefault = await loadToolDiscoveryDescriptor();
  const fromManifestPath = await loadToolDiscoveryDescriptor(TOOL_DISCOVERY_MANIFEST_PATH);

  assert.equal(isToolDiscoveryFragmentManifest(fromManifestPath), false);
  assert.deepEqual(
    fromManifestPath.tools.map((tool) => tool.tool_name),
    fromDefault.tools.map((tool) => tool.tool_name)
  );
  assert.equal(
    digestToolDiscoveryDescriptor(fromManifestPath),
    digestToolDiscoveryDescriptor(fromDefault)
  );
});

test("explicit descriptorPath envelope reports the explicit path and a stable digest", async () => {
  const fixture = makeFullDescriptor([
    makeFullDescriptorTool("fixture-alpha"),
    makeFullDescriptorTool("fixture-bravo", {
      entrypoint: "npm run wiki -- fixture-bravo --json",
      task_ids: ["validate-work-record"]
    })
  ]);
  const { tempDir, descriptorPath } = await writeFullDescriptorFixture(fixture);

  try {
    const envelope = await loadToolDiscoveryEnvelope({
      descriptorPath,
      interface: "descriptor",
      source_kind: "checked_in_descriptor",
      verbose: true
    });

    assert.equal(envelope.descriptor.path, descriptorPath);
    assert.notEqual(envelope.descriptor.path, TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH);

    const onDisk = JSON.parse(await readFile(descriptorPath, "utf8"));
    assert.equal(envelope.descriptor.digest, digestToolDiscoveryDescriptor(onDisk));
    assert.match(envelope.descriptor.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(envelope.freshness.state, "fresh");
    assert.equal(envelope.freshness.degraded, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("explicit full-descriptor digest changes when the descriptor content drifts", async () => {
  const baseFixture = makeFullDescriptor([makeFullDescriptorTool("fixture-alpha")]);
  const driftedFixture = makeFullDescriptor([
    makeFullDescriptorTool("fixture-alpha", { priority: 99 })
  ]);

  const base = await writeFullDescriptorFixture(baseFixture);
  const drifted = await writeFullDescriptorFixture(driftedFixture, {
    filename: TOOL_DISCOVERY_AGGREGATE_DESCRIPTOR_FILENAME
  });

  try {
    const baseDescriptor = await loadToolDiscoveryDescriptor(base.descriptorPath);
    const driftedDescriptor = await loadToolDiscoveryDescriptor(drifted.descriptorPath);

    assert.notEqual(
      digestToolDiscoveryDescriptor(baseDescriptor),
      digestToolDiscoveryDescriptor(driftedDescriptor),
      "a field-level change in the full descriptor must change its digest"
    );

    const baseReloaded = await loadToolDiscoveryDescriptor(base.descriptorPath);
    assert.equal(
      digestToolDiscoveryDescriptor(baseDescriptor),
      digestToolDiscoveryDescriptor(baseReloaded)
    );
  } finally {
    await rm(base.tempDir, { recursive: true, force: true });
    await rm(drifted.tempDir, { recursive: true, force: true });
  }
});

test("every assembled descriptor entry carries an explicit tier classification", {
  skip: "WK-1388 temporary skip pending descriptive tier-label implementation"
}, async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const unclassified = descriptor.tools.filter(
    (tool) => resolveToolTierVisibility(tool).length === 0
  );
  assert.deepEqual(
    unclassified.map((tool) => tool.tool_name),
    [],
    "missing tier metadata must fail closed, not default to free/agent-visible"
  );
});

test("tierVisibilityAllows composes free/local and paid/CCE as a fail-closed superset", () => {
  assert.equal(tierVisibilityAllows(["free_local"], "free_local"), true);
  assert.equal(tierVisibilityAllows(["free_local"], "paid_cce"), true);
  assert.equal(tierVisibilityAllows(["paid_cce"], "free_local"), false);
  assert.equal(tierVisibilityAllows(["paid_cce"], "paid_cce"), true);
  assert.equal(tierVisibilityAllows(["operator_only"], "free_local"), false);

  assert.equal(tierVisibilityAllows(["operator_only"], "paid_cce"), true);

  assert.equal(tierVisibilityAllows([], "free_local"), false);
  assert.equal(tierVisibilityAllows([], "paid_cce"), false);
});

test("free/local discovery projection hides paid tool names and CLI operator entries", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const free = rankToolDiscoveryTools(descriptor, { registered_tier: "free_local" }, { verbose: true });
  const freeNames = new Set(free.map((row) => row.tool_name));
  for (const paid of PAID_ONLY_TOOL_NAMES) {
    assert.equal(freeNames.has(paid), false, `${paid} must be hidden from free/local discovery`);
  }

  assert.equal(
    free.some((row) => row.kind === "cli_command"),
    false,
    "operator-only CLI fallbacks must not appear in free/local tier-projected discovery"
  );

  assert.ok(freeNames.has("workspace_search_repo"));
  assert.ok(freeNames.has("workspace_validate_dispatch"));
  assert.ok(freeNames.has("workspace_agent_dispatch"));
  assert.ok(freeNames.has("workspace_integrate_committed_slice"));
});

test("paid/CCE discovery projection exposes paid tools while free/local does not", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const paid = rankToolDiscoveryTools(descriptor, { registered_tier: "paid_cce" }, { verbose: true });
  const paidNames = new Set(paid.map((row) => row.tool_name));
  for (const name of PAID_ONLY_TOOL_NAMES) {
    assert.ok(paidNames.has(name), `${name} must be visible under the paid/CCE tier`);
  }
});

test("free/local projected prose does not leak paid-value tokens", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const free = rankToolDiscoveryTools(descriptor, { registered_tier: "free_local" }, { verbose: true });
  for (const row of free) {
    if (typeof row.notes !== "string") continue;
    const lower = row.notes.toLowerCase();
    for (const token of PAID_PROSE_TOKENS) {
      assert.equal(
        lower.includes(token.toLowerCase()),
        false,
        `free/local notes for ${row.tool_name} leak paid token "${token}"`
      );
    }
  }
});

test("mixed-route tier_text projects paid detail only under the paid tier, fail-closed to free base", () => {
  const mixed = {
    tool_name: "mixed_fixture",
    tier_visibility: ["free_local", "paid_cce"],
    notes: "Free-safe base guidance.",
    tier_text: { paid_cce: { notes: "Paid detail: blast-radius level and cluster count." } }
  };
  assert.equal(projectToolDiscoveryEntryForTier(mixed, "free_local").notes, "Free-safe base guidance.");
  assert.match(projectToolDiscoveryEntryForTier(mixed, "paid_cce").notes, /blast-radius/);

  assert.equal(projectToolDiscoveryEntryForTier(mixed, undefined).notes, "Free-safe base guidance.");

  assert.equal("tier_text" in projectToolDiscoveryEntryForTier(mixed, "paid_cce"), false);
});

test("run-status/run-wait descriptors document free-tier structured_role_result.valid false", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  for (const name of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
    const row = descriptor.tools.find((tool) => tool.tool_name === name);
    assert.ok(row, `${name} present`);
    assert.match(row.notes, /structured_role_result\.valid:false/);
    assert.match(row.notes, /DEC-0128/);
  }
});

test("launcher discovery entries carry compact routing guidance metadata", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const tools = new Map(descriptor.tools.map((tool) => [tool.tool_name, tool]));

  const dispatch = tools.get("workspace_agent_dispatch");
  assert.ok(dispatch, "workspace_agent_dispatch present");
  assert.deepEqual(
    {
      use_when: dispatch.use_when,
      do_not_use_when: dispatch.do_not_use_when,
      authoritative_for: dispatch.authoritative_for,
      recommended_first_call: dispatch.recommended_first_call,
      requires_prior_state: dispatch.requires_prior_state,
      replacement_for_misuse: dispatch.replacement_for_misuse
    },
    {
      use_when: [
        "The dispatch_role_call intent has a dispatchable workspace_validate_dispatch result for the same unit and role."
      ],
      do_not_use_when: [
        "Readiness is unknown; use workspace_validate_dispatch first.",
        "The task asks about an existing run; use workspace_agent_run_status or workspace_agent_run_wait."
      ],
      authoritative_for: [
        "dispatch_role_call:launch_after_dispatchable",
        "launcher-owned worker/reviewer/redteam process spawn"
      ],
      recommended_first_call: undefined,
      requires_prior_state: [
        "Known subject and role.",
        "Same-unit same-role workspace_validate_dispatch result with dispatchable=true."
      ],
      replacement_for_misuse: [
        {
          misuse_code: "dispatch_without_readiness_validation",
          routing_intent: "dispatch_role_call",
          use_instead: "workspace_validate_dispatch"
        }
      ]
    }
  );

  for (const [toolName, expectedGuidance] of [
    [
      "workspace_agent_run_status",
      {
        use_when: [
          "The run_monitoring intent asks for status, output, failure, or completion of an already dispatched run."
        ],
        authoritative_for: ["run_monitoring:status", "launcher run lifecycle by monitor_handle"],
        recommended_first_call: {
          routing_intents: ["run_monitoring"],
          arguments: {
            monitor_handle: "$monitor_handle_if_known",
            subject: "$unit_if_known"
          },
          omit_null_arguments: true
        },
        requires_prior_state: ["Server-minted monitor_handle from workspace_agent_dispatch."],
        misuse_use_instead: "workspace_agent_run_status"
      }
    ],
    [
      "workspace_agent_run_wait",
      {
        use_when: [
          "The run_monitoring intent asks to wait briefly for an already dispatched run to finish."
        ],
        authoritative_for: ["run_monitoring:bounded_wait", "launcher run lifecycle by monitor_handle"],
        recommended_first_call: {
          routing_intents: ["run_monitoring"],
          operation: "bounded wait",
          arguments: {
            monitor_handle: "$monitor_handle_if_known",
            subject: "$unit_if_known"
          },
          omit_null_arguments: true
        },
        requires_prior_state: [
          "Server-minted monitor_handle from workspace_agent_dispatch.",
          "A bounded wait request."
        ],
        misuse_use_instead: "workspace_agent_run_wait"
      }
    ]
  ]) {
    const tool = tools.get(toolName);
    assert.ok(tool, `${toolName} present`);
    assert.deepEqual(tool.use_when, expectedGuidance.use_when);
    assert.deepEqual(tool.do_not_use_when, [
      "The task is a new role launch; use workspace_validate_dispatch first.",
      "No monitor handle is available; ask for it instead of searching, reading records, or relaunching."
    ]);
    assert.deepEqual(tool.authoritative_for, expectedGuidance.authoritative_for);
    assert.deepEqual(tool.recommended_first_call, expectedGuidance.recommended_first_call);
    assert.deepEqual(tool.requires_prior_state, expectedGuidance.requires_prior_state);
    assert.deepEqual(tool.replacement_for_misuse, [
      {
        misuse_code: "ignored_required_next_action",
        routing_intent: "run_monitoring",
        use_instead: expectedGuidance.misuse_use_instead
      }
    ]);
  }

  for (const toolName of ["workspace_agent_dispatch", "workspace_agent_run_status", "workspace_agent_run_wait"]) {
    const compact = compactToolDiscoveryEntry(tools.get(toolName));
    for (const fieldName of LAUNCHER_GUIDANCE_FIELD_NAMES) {
      assert.equal(fieldName in compact, false, `${toolName} compact projection must omit ${fieldName}`);
    }
  }
});

test("code-index descriptor prose does not collide product tiers with the response-shape contract", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  for (const tool of descriptor.tools) {
    const notes = typeof tool.notes === "string" ? tool.notes : "";
    assert.equal(
      /three-tier contract/i.test(notes),
      false,
      `${tool.tool_name} must not use "three-tier contract" for response-shape behavior`
    );
    assert.equal(
      /agent-authoritative/i.test(notes),
      false,
      `${tool.tool_name} must not use agent-authoritative as an availability signal`
    );
  }
});

test("findings authoring routes publish the conditional redteam contract", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const byName = new Map(descriptor.tools.map((tool) => [tool.tool_name, tool]));

  for (const toolName of ["workspace_work_record_ready_slice"]) {
    const tool = byName.get(toolName);
    assert.ok(tool, toolName);
    const useWhen = tool.use_when.join(" | ");
    assert.match(useWhen, /review->reviewer/u, toolName);
    assert.match(useWhen, /redteam->redteam/u, toolName);
    assert.match(useWhen, /redteam requires review_purpose='standalone'/u, toolName);
    assert.ok(
      tool.requires_prior_state.some((entry) => /standalone/u.test(entry) && /redteam/u.test(entry)),
      `${toolName} must state the conditional redteam prerequisite`
    );
    assert.ok(
      tool.authoritative_for.includes("conditional redteam review_purpose requirement at authoring time"),
      toolName
    );
    assert.ok(tool.docs_refs.includes("docs/work-record-schema.md"), toolName);
  }

  const upsert = byName.get("workspace_work_record_upsert_slice");
  assert.match(upsert.use_when.join(" | "), /omitted dispatch role is derived from work_kind/u);
  assert.match(upsert.use_when.join(" | "), /explicitly conflicting role is refused/u);
  assert.ok(upsert.docs_refs.includes("docs/work-record-schema.md"));
});

test("the advertised redteam example executes against the production ready-slice planner", async () => {
  const { planWorkRecordReadySlice } = await import(
    "../../packages/wiki-core/src/lib/work-record-ready-slice-contract.mjs"
  );
  const descriptor = await loadToolDiscoveryDescriptor();
  const example = descriptor.tools.find(
    (tool) => tool.tool_name === "workspace_work_record_ready_slice"
  ).recommended_first_call.arguments;

  assert.equal(example.shaping_mode, "redteam");
  assert.equal(example.review_purpose, "standalone");

  const resolve = (value) => {
    if (typeof value === "string") return value.startsWith("$") ? `resolved ${value.slice(1)}` : value;
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolve(entry)]));
    }
    return value;
  };
  const request = { ...resolve(example), unit: "WK-9298", repo_paths: ["AGENTS.md"] };

  const record = {
    schema_version: "work-record.v1",
    id: "WK-9298",
    repo: "agent-chassis/agent-chassis",
    title: "Discovery example fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-08-26",
    updated: "2026-08-26",
    read_scope: ["AGENTS.md"],
    repo_paths: [],
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
    acceptance: { criteria: [], validation: [] },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null,
    initiative: "IN-0030"
  };

  const planned = planWorkRecordReadySlice(record, request);
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  const slice = planned.updatedRecord.slices[0];
  assert.equal(slice.work_kind, "redteam");
  assert.equal(slice.review_purpose, "standalone");
  assert.equal(slice.dispatch_intent.intended_agent_role, "redteam");
  assert.deepEqual(slice.write_scope, []);

  const withoutPurpose = { ...request };
  delete withoutPurpose.review_purpose;
  const refused = planWorkRecordReadySlice(record, withoutPurpose);
  assert.equal(refused.ok, false);
  assert.equal(refused.diagnostics[0].path, "review_purpose");
});
