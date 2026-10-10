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
  describeToolDiscoveryTools,
  digestToolDiscoveryDescriptor,
  isToolDiscoveryFragmentManifest,
  listToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  loadToolDiscoveryEnvelope,
  projectToolDiscoveryEntryForTier,
  rankToolDiscoveryTools,
  resolveToolTierVisibility,
  tierVisibilityAllows,
  validateToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const PAID_ONLY_TOOL_NAMES = [
  "query_code_index",
  "workspace_code_index_build",
  "workspace_code_index_rebuild"
];

const FREE_LOCAL_TASK_TOOL_NAMES = [
  "workspace_read_wiki",
  "workspace_create_record",
  "save_record",
  "workspace_assess_contract",
  "workspace_find_proofs",
  "verify_proof",
  "workspace_run_test",
  "start_agent",
  "get_run_result",
  "workspace_deliver_work",
  "integrate_work",
  "workspace_inspect_candidate",
  "workspace_advance_candidate",
  "workspace_publish_work",
  "workspace_check_landing"
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

const RETIRED_DERIVED_EVIDENCE_REFRESH_TOOL_NAMES = [
  "workspace_work_record_refresh_target_resolution_evidence",
  "workspace_work_record_refresh_admission_metrics"
];

const DERIVED_EVIDENCE_REFRESH_TOOL_NAMES = [
  "workspace_code_index_build",
  "workspace_code_index_rebuild"
];
const LAUNCHER_GUIDANCE_FIELD_NAMES = [
  "use_when",
  "do_not_use_when",
  "authoritative_for",
  "recommended_first_call",
  "requires_prior_state",
  "replacement_for_misuse"
];

const TASK_ROUTE_BOUNDARY =
  "The request needs an ungranted role, caller-selected repository or another task.";

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

test("tool discovery descriptor keeps task ids controlled and derived-evidence refresh metadata fresh", async () => {
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

  const advertised = new Set(descriptor.tools.map((tool) => tool.tool_name));
  for (const retired of RETIRED_DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    assert.equal(advertised.has(retired), false,
      `the retired refresh route ${retired} must not reappear in the descriptor`);
  }

  for (const owner of DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    const derivedEvidenceTool = descriptor.tools.find((tool) => tool.tool_name === owner);
    assert.ok(derivedEvidenceTool, `expected ${owner} metadata in the descriptor`);
    assert.equal(derivedEvidenceTool.kind, "mcp_tool");
    assert.ok(derivedEvidenceTool.task_ids.includes("refresh-derived-evidence"));
  }
  assert.deepEqual(
    descriptor.tools
      .filter((tool) => tool.kind === "mcp_tool" && tool.task_ids.includes("refresh-derived-evidence"))
      .map((tool) => tool.tool_name),
    DERIVED_EVIDENCE_REFRESH_TOOL_NAMES,
    "the refresh task id has exactly its two MCP owners"
  );

  const rankedTools = rankToolDiscoveryTools(descriptor, {
    task_id: "refresh-derived-evidence"
  }, { verbose: false });
  const rankedNames = rankedTools.map((tool) => tool.tool_name);
  for (const owner of DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    assert.ok(rankedNames.includes(owner),
      `${owner} should be discoverable through the approved task id`);
  }
  for (const retired of RETIRED_DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    assert.equal(rankedNames.includes(retired), false,
      "a retired route must not be rankable through an approved task id");
  }

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
    "descriptor-envelope validation should not report invalid_task_id"
  );
  const envelopeNames = envelope.results.map((tool) => tool.tool_name);
  for (const owner of DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    assert.ok(envelopeNames.includes(owner), `descriptor envelope should surface ${owner}`);
  }
  for (const retired of RETIRED_DERIVED_EVIDENCE_REFRESH_TOOL_NAMES) {
    assert.equal(envelopeNames.includes(retired), false,
      `descriptor envelope must not surface the retired route ${retired}`);
  }
});

test("task-directed coverage intents are controlled and validate on current read rows", async () => {
  const controlledTaskIds = new Set(TOOL_DISCOVERY_CONTROLLED_TASK_IDS);
  for (const taskId of WK_2437_CONTROLLED_TASK_IDS) {
    assert.equal(controlledTaskIds.has(taskId), true, `${taskId} must remain controlled`);
  }

  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  assert.deepEqual(validation.diagnostics.filter(({ code }) => code === "invalid_task_id"), []);

  const expectedRows = new Map([
    ["workspace_assess_contract", ["controlled-contract-assessment"]],
    ["workspace_find_proofs", ["controlled-contract-proof-selection"]],
    ["verify_proof", ["controlled-contract-assessment"]],
    ["save_record", ["contract-edit"]]
  ]);
  for (const [toolName, expectedTaskIds] of expectedRows) {
    const row = descriptor.tools.find(({ tool_name: candidate }) => candidate === toolName);
    assert.ok(row, `${toolName} must remain in the assembled descriptor`);
    assert.deepEqual(row.task_ids, expectedTaskIds);
    for (const taskId of expectedTaskIds) {
      assert.equal(controlledTaskIds.has(taskId), true, `${toolName}:${taskId}`);
    }
  }

  const sideEffectsOf = (toolName) =>
    descriptor.tools.find(({ tool_name: candidate }) => candidate === toolName).side_effects;
  assert.deepEqual(sideEffectsOf("workspace_assess_contract"), ["read_only"]);
  assert.deepEqual(sideEffectsOf("workspace_find_proofs"), ["read_only"]);
  assert.deepEqual(sideEffectsOf("verify_proof"), ["process_spawn", "workspace_write"]);

  for (const retired of descriptor.tools.filter(({ tool_name: name }) =>
    name.startsWith("workspace_controlled_contract_"))) {
    assert.fail(`${retired.tool_name} must not reappear in the assembled descriptor`);
  }
  for (const taskId of [...WK_2437_CONTROLLED_TASK_IDS, "controlled-contract-authoring"]) {
    assert.equal(controlledTaskIds.has(taskId), true, `${taskId} must remain controlled`);
    assert.deepEqual(
      descriptor.tools.filter((tool) => tool.task_ids.includes(taskId))
        .map(({ tool_name: name }) => name),
      [],
      `${taskId} has no advertised owner after the controlled-contract route retirement`
    );
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
      toolName: "workspace_inspect_candidate",
      sideEffects: ["read_only"]
    },
    {
      taskId: "advance-terminal-review-candidate",
      toolName: "workspace_advance_candidate",
      sideEffects: ["workspace_write"]
    }
  ]) {
    const results = rankToolDiscoveryTools(
      descriptor,
      { task_id: expected.taskId },
      { verbose: true }
    );
    const tool = results.find(({ tool_name: toolName }) => toolName === expected.toolName);
    assert.ok(tool, expected.taskId);
    assert.deepEqual(tool.side_effects, expected.sideEffects);
    assert.deepEqual(tool.authority, ["checked_in_descriptor", "runtime_env", "workspace_repo"]);
    assert.equal(tool.runtime_posture, "supported");
    for (const retired of [
      "workspace_terminal_review_candidate_status",
      "workspace_terminal_review_candidate_advance"
    ]) {
      assert.equal(results.some(({ tool_name: toolName }) => toolName === retired), false, retired);
    }
  }

  const candidateReads = rankToolDiscoveryTools(
    descriptor, { task_id: "query-terminal-review-candidate" }, { verbose: true });
  assert.deepEqual(candidateReads.map(({ tool_name: toolName }) => toolName).sort(),
    ["workspace_check_landing", "workspace_inspect_candidate"]);
  for (const read of candidateReads) assert.deepEqual(read.side_effects, ["read_only"], read.tool_name);

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

  assert.deepEqual(
    free.filter((row) => !row.tier_visibility.includes("free_local")).map((row) => row.tool_name),
    [],
    "every free/local row must be classified free_local"
  );

  for (const name of FREE_LOCAL_TASK_TOOL_NAMES) {
    assert.ok(freeNames.has(name), `${name} must stay visible to free/local discovery`);
  }
});

test("delivery integration discovery advertises only the registered delivery argument", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const integration = descriptor.tools.find(
    (entry) => entry.tool_name === "integrate_work"
  );
  assert.ok(integration);

  assert.deepEqual(integration.recommended_first_call.arguments, { delivery: "$delivery" });
  for (const retiredArgument of ["subject", "dispositions", "comment_dispositions"]) {
    assert.equal(
      Object.hasOwn(integration.recommended_first_call.arguments, retiredArgument),
      false,
      retiredArgument
    );
  }
  assert.match(integration.notes, /Explicitly integrate one exact authenticated delivery/u);
  assert.match(integration.notes, /saved dispositions are advisory/u);
  assert.deepEqual(integration.side_effects, ["workspace_write"]);
  assert.equal(
    descriptor.tools.some((entry) => entry.tool_name === "workspace_integrate_committed_slice"),
    false,
    "the retired committed-slice integration route must not be advertised"
  );

  const deliver = descriptor.tools.find((entry) => entry.tool_name === "workspace_deliver_work");
  assert.ok(deliver);
  assert.deepEqual(deliver.recommended_first_call.arguments, {});
  assert.match(deliver.notes, /never integrates/u);
});

test("paid/CCE discovery projection exposes paid tools while free/local does not", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const paid = rankToolDiscoveryTools(descriptor, { registered_tier: "paid_cce" }, { verbose: true });
  const paidNames = new Set(paid.map((row) => row.tool_name));
  const free = rankToolDiscoveryTools(descriptor, { registered_tier: "free_local" }, { verbose: true });
  const freeNames = new Set(free.map((row) => row.tool_name));
  for (const name of PAID_ONLY_TOOL_NAMES) {
    assert.ok(paidNames.has(name), `${name} must be visible under the paid/CCE tier`);
    assert.equal(freeNames.has(name), false, `${name} must stay hidden from free/local`);
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

test("run-result descriptor is a read-only observation that launches and integrates nothing", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const row = descriptor.tools.find((tool) => tool.tool_name === "get_run_result");
  assert.ok(row, "get_run_result present");
  assert.deepEqual(row.side_effects, ["read_only"]);
  assert.deepEqual(row.task_ids, ["query-agent-run-status"]);
  assert.match(row.notes, /Observe a known attempt or read an authenticated original/u);
  assert.match(row.notes, /reads launch and integrate nothing/u);

  assert.deepEqual(
    descriptor.tools.filter((tool) => tool.task_ids.includes("query-agent-run-status"))
      .map((tool) => tool.tool_name),
    ["get_run_result"]
  );
  for (const retired of ["workspace_agent_run_status", "workspace_agent_run_wait"]) {
    assert.equal(descriptor.tools.some((tool) => tool.tool_name === retired), false, retired);
  }
});

test("launcher discovery entries carry compact routing guidance metadata", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const tools = new Map(descriptor.tools.map((tool) => [tool.tool_name, tool]));
  const guidanceOf = (tool) => ({
    use_when: tool.use_when,
    do_not_use_when: tool.do_not_use_when,
    authoritative_for: tool.authoritative_for,
    recommended_first_call: tool.recommended_first_call,
    requires_prior_state: tool.requires_prior_state,
    replacement_for_misuse: tool.replacement_for_misuse
  });

  const taskGuidance = (meaning, firstCallArguments) => ({
    use_when: [meaning],
    do_not_use_when: [TASK_ROUTE_BOUNDARY],
    authoritative_for: [meaning],
    recommended_first_call: { operation: meaning, arguments: firstCallArguments, omit_null_arguments: true },
    requires_prior_state: undefined,
    replacement_for_misuse: undefined
  });

  const start = tools.get("start_agent");
  assert.ok(start, "start_agent present");
  assert.deepEqual(guidanceOf(start), taskGuidance(
    "Start one saved canonical assignment or preview its action or configured capability; never integrates.",
    { subject: "$unit" }
  ));
  assert.deepEqual(start.side_effects, ["process_spawn"]);
  assert.deepEqual(start.task_ids, ["dispatch-worker"]);

  const startGuidance = [
    start.notes, ...start.use_when, ...start.do_not_use_when, ...start.authoritative_for
  ].join("\n");
  assert.doesNotMatch(startGuidance, /must be dispatchable/u);
  assert.doesNotMatch(startGuidance, /validate_dispatch/u);
  assert.doesNotMatch(startGuidance, /launch_after_dispatchable/u);
  assert.equal(start.requires_prior_state, undefined);

  const result = tools.get("get_run_result");
  assert.ok(result, "get_run_result present");
  assert.deepEqual(guidanceOf(result), taskGuidance(
    "Observe a known attempt or read an authenticated original; reads launch and integrate nothing.",
    { subject: "$unit" }
  ));

  for (const retired of [
    "workspace_agent_dispatch",
    "workspace_agent_run_status",
    "workspace_validate_dispatch",
    "workspace_initiative_status"
  ]) {
    assert.equal(tools.has(retired), false, `${retired} is retired and must not be advertised`);
  }
  const preflight = tools.get("workspace_preflight_dispatch");
  assert.ok(preflight, "workspace_preflight_dispatch present");
  assert.deepEqual(preflight.tier_visibility, ["operator_only"]);
  assert.deepEqual(preflight.side_effects, ["read_only"]);
  assert.deepEqual(preflight.authoritative_for,
    ["structural preflight of caller-supplied proposed record content"]);

  for (const toolName of ["start_agent", "get_run_result"]) {
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

  const codeQuery = descriptor.tools.find((tool) => tool.tool_name === "query_code_index");
  const preparation = codeQuery.do_not_use_when.filter((entry) => /prepare/iu.test(entry));
  assert.equal(preparation.length, 1);
  assert.match(preparation[0], /status:true.*purpose prepare_index.*preparation\.missing_capability/u);
  assert.doesNotMatch([codeQuery.notes, ...codeQuery.use_when, ...codeQuery.do_not_use_when].join(" "),
    /workspace_code_index_(?:build|rebuild)|operator-only/u);
});

test("WK-2603 discovery uses one retained ranking owner", async () => {
  const barrel = await import("../../packages/wiki-core/src/lib/tool-discovery.mjs");
  const projection = await import("../../packages/wiki-core/src/lib/tool-discovery/projection.mjs");
  for (const namespace of [barrel, projection]) {
    assert.equal(Object.hasOwn(namespace, "queryToolDiscoveryDescriptor"), false,
      "the test-only query alias is removed");
  }

  const taskId = "dispatch-worker";
  const rows = [
    makeFullDescriptorTool("beta", { priority: 5, task_ids: [taskId], entrypoint: "run beta" }),
    makeFullDescriptorTool("alpha", { priority: 5, task_ids: [taskId], entrypoint: "run alpha z" }),
    makeFullDescriptorTool("zeta", { priority: 50, task_ids: [taskId], entrypoint: "run zeta" }),
    makeFullDescriptorTool("alpha", { priority: 5, task_ids: [taskId], entrypoint: "run alpha a" }),
    makeFullDescriptorTool("other", { priority: 99, task_ids: ["read-canonical"], entrypoint: "run other" })
  ];
  const expected = ["zeta:run zeta", "alpha:run alpha a", "alpha:run alpha z", "beta:run beta"];
  const identity = (entry) => `${entry.tool_name}:${entry.entrypoint}`;
  for (const order of [rows, [...rows].reverse()]) {
    const ranked = rankToolDiscoveryTools(order, { task_id: taskId }, { verbose: true });
    assert.deepEqual(ranked.map(identity), expected);
    ranked.forEach((entry, index) => assert.equal(entry.rank, index + 1));
    assert.deepEqual(describeToolDiscoveryTools(order, { task_id: taskId }, { verbose: true }).map(identity), expected);
    assert.deepEqual(
      listToolDiscoveryTools(order, { task_id: taskId }, { createNextCalls: () => [] }).tools.map((row) => row.tool_name),
      expected.map((value) => value.split(":")[0])
    );
    const cliEnvelope = createToolDiscoveryEnvelope({
      interface: "cli",
      source_kind: "checked_in_descriptor",
      descriptor: makeFullDescriptor(order),
      query: { task_id: taskId }
    });
    assert.deepEqual(cliEnvelope.results.map(identity), expected);
  }

  const descriptor = await loadToolDiscoveryDescriptor();
  const query = { task_id: "inspect-provenance" };
  const ranked = rankToolDiscoveryTools(descriptor, query, { verbose: true });
  assert.ok(ranked.length > 1);
  for (let index = 1; index < ranked.length; index += 1) {
    const [left, right] = [ranked[index - 1], ranked[index]];
    const ordered = left.priority > right.priority ||
      (left.priority === right.priority && (left.tool_name.localeCompare(right.tool_name) < 0 ||
        (left.tool_name === right.tool_name && left.entrypoint.localeCompare(right.entrypoint) <= 0)));
    assert.ok(ordered, `${left.tool_name} precedes ${right.tool_name}`);
  }
  const names = ranked.map((entry) => entry.tool_name);
  assert.deepEqual(describeToolDiscoveryTools(descriptor, query, { verbose: false }).map((entry) => entry.tool_name), names);
  assert.deepEqual(listToolDiscoveryTools(descriptor, { ...query, limit: 10_000 },
    { createNextCalls: () => [] }).tools.map((row) => row.tool_name), names);
  assert.deepEqual(createToolDiscoveryEnvelope({ interface: "cli", descriptor, query }).results
    .map((entry) => entry.tool_name), names);
});
