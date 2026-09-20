import test from "node:test";
import assert from "node:assert/strict";

import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  evaluateAgentToolTokenBudgetDebt,
  loadToolDiscoveryManifest
} from "../../packages/wiki-core/src/lib/tool-discovery/descriptor.mjs";

const SLICE_021_MAX_NOTES_CHARS = 1200;

const SLICE_021_MAX_AGGREGATE_NOTES_CHARS = 62000;

const SLICE_021_MAX_DISTINCT_WK_IDS_PER_NOTE = 1;

const SLICE_021_BANNED_SCHEMA_TOKENS = [
  "schema_version",
  "backlink_count",
  "markdown_link_count",
  "slice_counts",
  "source_entries",
  "graph_sidecar_digest",
  "finding_count_total",
  "findings_returned",
  "findings_truncated"
];

const SLICE_021_DUP_SENTENCE_MIN_CHARS = 100;
const SLICE_021_DUP_SENTENCE_MAX_NOTES = 2;

function collectDiscoveryProse(descriptor) {
  const prose = [];
  for (const tool of descriptor.tools) {
    if (typeof tool.notes === "string" && tool.notes.trim().length > 0) {
      prose.push({ tool_name: tool.tool_name, surface: "notes", text: tool.notes });
    }
    for (const [tier, block] of Object.entries(tool.tier_text ?? {})) {
      for (const [field, text] of Object.entries(block ?? {})) {
        if (typeof text === "string" && text.trim().length > 0) {
          prose.push({ tool_name: tool.tool_name, surface: `tier_text.${tier}.${field}`, text });
        }
      }
    }
  }
  return prose;
}

function findDiscoveryProseViolations(prose) {
  const violations = [];
  for (const { tool_name, surface, text } of prose) {
    const at = { tool_name, surface };
    if (text.length > SLICE_021_MAX_NOTES_CHARS) {
      violations.push({ ...at, rule: "per_note_ceiling", detail: text.length });
    }
    const sliceTokens = text.replace(/\b(WK-\d{3,})#SLICE-\d+\b/g, "$1").match(/\bSLICE-\d+\b/g);
    if (sliceTokens) {
      violations.push({ ...at, rule: "slice_provenance", detail: sliceTokens });
    }
    const wkIds = [...new Set(text.match(/\bWK-\d{3,}\b/g) ?? [])];
    if (wkIds.length > SLICE_021_MAX_DISTINCT_WK_IDS_PER_NOTE) {
      violations.push({ ...at, rule: "wk_provenance", detail: wkIds });
    }
    const modulePaths = text.match(/[\w-]+\.mjs\b/g);
    if (modulePaths) {
      violations.push({ ...at, rule: "module_path", detail: modulePaths });
    }
    const schemaToken = SLICE_021_BANNED_SCHEMA_TOKENS.find((token) => text.includes(token));
    if (schemaToken) {
      violations.push({ ...at, rule: "schema_inventory", detail: schemaToken });
    }
  }
  const sentenceToTools = new Map();
  for (const { tool_name, text } of prose) {
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= SLICE_021_DUP_SENTENCE_MIN_CHARS);
    for (const sentence of sentences) {
      if (!sentenceToTools.has(sentence)) sentenceToTools.set(sentence, new Set());
      sentenceToTools.get(sentence).add(tool_name);
    }
  }
  for (const [sentence, tools] of sentenceToTools) {
    if (tools.size > SLICE_021_DUP_SENTENCE_MAX_NOTES) {
      violations.push({ tool_name: [...tools].join(", "), surface: "sentence", rule: "duplicate_sentence", detail: sentence });
    }
  }
  return violations;
}

function violationsFor(prose, rule) {
  return findDiscoveryProseViolations(prose).filter((violation) => violation.rule === rule);
}

let assembledProseCache = null;

async function loadAssembledProse() {
  if (!assembledProseCache) {
    assembledProseCache = collectDiscoveryProse(await loadToolDiscoveryDescriptor());
    assert.ok(
      assembledProseCache.some(({ surface }) => surface === "notes"),
      "expected the assembled corpus to carry at least one notes entry to guard"
    );
  }
  return assembledProseCache;
}

test("WK-1010#SLICE-021: discovery notes and tier overrides stay within the per-note verbosity budget", async () => {
  assert.deepEqual(
    violationsFor(await loadAssembledProse(), "per_note_ceiling"),
    [],
    `each base note and tier override must stay within ${SLICE_021_MAX_NOTES_CHARS} chars; ` +
      "trim to selection guidance rather than regrowing a changelog/schema essay."
  );
});

test("tier overrides are enumerated from the corpus and counted apart from the raw-notes aggregate", async () => {
  const [descriptor, manifest] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest()
  ]);
  const prose = collectDiscoveryProse(descriptor);
  const expectedOverrides = descriptor.tools.flatMap((tool) =>
    Object.entries(tool.tier_text ?? {}).flatMap(([tier, block]) =>
      Object.keys(block ?? {}).map((field) => `${tool.tool_name}:tier_text.${tier}.${field}`)));
  const overrides = prose.filter(({ surface }) => surface !== "notes");
  assert.ok(overrides.length > 0, "the corpus carries tier overrides to guard");
  assert.deepEqual(
    overrides.map(({ tool_name, surface }) => `${tool_name}:${surface}`),
    expectedOverrides
  );
  const report = evaluateAgentToolTokenBudgetDebt(descriptor, manifest).raw_discovery_notes;
  assert.equal(report.denominator, prose.filter(({ surface }) => surface === "notes").length);
  assert.equal(
    report.current_value,
    prose.filter(({ surface }) => surface === "notes").reduce((sum, { text }) => sum + text.length, 0),
    "tier overrides are not part of the historical raw-notes aggregate"
  );
});

test("a tier-only overlong, historical, mechanical, or copied essay is detected without changing base debt", async () => {
  const [descriptor, manifest] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest()
  ]);
  const baseline = evaluateAgentToolTokenBudgetDebt(descriptor, manifest).raw_discovery_notes;
  assert.deepEqual(findDiscoveryProseViolations(collectDiscoveryProse(descriptor)), []);
  const subject = descriptor.tools.find((tool) => typeof tool.notes === "string" && !tool.tier_text);
  assert.ok(subject, "fixture precondition: a noted row without a tier override exists");

  const essays = [
    ["per_note_ceiling", "x".repeat(SLICE_021_MAX_NOTES_CHARS + 1)],
    ["wk_provenance", "Paid guidance restored after WK-1111 and reverted by WK-2222."],
    ["slice_provenance", "Paid guidance landed in SLICE-004 of the rollout."],
    ["module_path", "Paid dispatch is wired through agent-dispatch-launch-route.mjs."],
    ["schema_inventory", "Paid output carries schema_version and finding_count_total."]
  ];
  for (const [rule, essay] of essays) {
    const mutated = structuredClone(descriptor);
    mutated.tools.find((tool) => tool.tool_name === subject.tool_name).tier_text = {
      paid_cce: { notes: essay }
    };
    const violations = findDiscoveryProseViolations(collectDiscoveryProse(mutated));
    assert.deepEqual(
      violations.map(({ tool_name, surface, rule: found }) => [tool_name, surface, found]),
      [[subject.tool_name, "tier_text.paid_cce.notes", rule]],
      rule
    );
    const report = evaluateAgentToolTokenBudgetDebt(mutated, manifest).raw_discovery_notes;
    assert.equal(report.current_value, baseline.current_value, `${rule} leaves base debt unchanged`);
    assert.equal(report.debt_added, baseline.debt_added, `${rule} leaves base debt unchanged`);
  }

  const copied = structuredClone(descriptor);
  const boilerplate = "This copied paid-tier boilerplate sentence explains the same launcher internals " +
    "again for every single route that carries it.";
  const hosts = copied.tools.filter((tool) => typeof tool.notes === "string").slice(0, 3);
  for (const tool of hosts) tool.tier_text = { paid_cce: { notes: boilerplate } };
  assert.deepEqual(
    findDiscoveryProseViolations(collectDiscoveryProse(copied)).map(({ rule }) => rule),
    ["duplicate_sentence"]
  );
});

test("WK-2194: aggregate discovery-notes budget remains bounded after adapter retirement", async () => {
  const [descriptor, manifest] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest()
  ]);
  const report = evaluateAgentToolTokenBudgetDebt(descriptor, manifest).raw_discovery_notes;
  assert.equal(report.target, SLICE_021_MAX_AGGREGATE_NOTES_CHARS);

  assert.ok(report.current_value < 46752);
  assert.equal(report.denominator, 106);
  assert.equal(report.debt_added, 204);
  assert.ok(report.debt_retired >= 17937);
  assert.deepEqual(report.added_entry_names, [
    "wiki-validate-dispatch",
    "wiki-work-records-cleanup-derived-evidence",
    "wiki-work-records-set-task"
  ]);
  assert.equal(report.remaining_excess, 0);
  assert.equal(report.within_target, true, "the measured corpus must remain within 62,000 chars");
  assert.equal(report.growth_free, false);
  assert.equal(report.owner, "tool-discovery notes/description budget test family");
  assert.equal(report.target_wk, "WK-2194");
  assert.equal(
    manifest.agent_tool_token_budget_debt.raw_discovery_notes.baseline_lengths
      .workspace_work_record_set_list_field,
    670
  );
  assert.equal(
    manifest.agent_tool_token_budget_debt.live_paid_operator_descriptions.baseline_lengths
      .workspace_work_record_set_list_field,
    319
  );
  assert.equal(
    report.retired_entry_names.includes("workspace_work_record_set_list_field"),
    true
  );
});

test("WK-2253: per-entry debt applies only while structured metadata is incomplete", async () => {
  const [descriptor, manifest] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest()
  ]);
  const baseline = evaluateAgentToolTokenBudgetDebt(
    descriptor,
    manifest
  ).raw_discovery_notes;
  const changed = structuredClone(descriptor);
  const enlarged = changed.tools.find((tool) => tool.tool_name === "workspace_tools_list");
  const reduced = changed.tools.find((tool) => tool.tool_name === "workspace_authoring_ergonomics_report");

  const growth = " Added prose.".length;
  enlarged.notes = "x".repeat(
    manifest.agent_tool_token_budget_debt.raw_discovery_notes.baseline_lengths.workspace_tools_list + growth
  );
  reduced.notes = reduced.notes.slice(0, -100);
  const completeReport = evaluateAgentToolTokenBudgetDebt(changed, manifest).raw_discovery_notes;
  assert.equal(completeReport.debt_added, baseline.debt_added);
  assert.ok(completeReport.metadata_complete_growth_names.includes("workspace_tools_list"));

  enlarged.use_when = [];
  const report = evaluateAgentToolTokenBudgetDebt(changed, manifest).raw_discovery_notes;
  assert.equal(report.current_value < report.baseline_value, true);
  assert.equal(report.debt_added - baseline.debt_added, growth);
  assert.ok(report.added_entry_names.includes("workspace_tools_list"));
  assert.ok(report.debt_retired >= 100);
  assert.equal(report.growth_free, false);
});

test("WK-1010#SLICE-021: discovery notes and tier overrides carry no WK/SLICE changelog provenance", async () => {
  const prose = await loadAssembledProse();
  assert.deepEqual(
    [...violationsFor(prose, "slice_provenance"), ...violationsFor(prose, "wk_provenance")],
    [],
    `notes may not cite slice provenance or more than ${SLICE_021_MAX_DISTINCT_WK_IDS_PER_NOTE} ` +
      "distinct WK id; provenance belongs in the WK record and docs."
  );
});

test("WK-1010#SLICE-021: discovery notes and tier overrides dump no backend/source .mjs module paths", async () => {
  assert.deepEqual(
    violationsFor(await loadAssembledProse(), "module_path"),
    [],
    "implementation wiring belongs in source comments and the WK, not selection notes."
  );
});

test("WK-1010#SLICE-021: discovery notes and tier overrides dump no schema/response-shape field inventories", async () => {
  assert.deepEqual(
    violationsFor(await loadAssembledProse(), "schema_inventory"),
    [],
    "keep field/response shapes in docs/tool-discovery.md and the live schema, not the notes."
  );
});

test("WK-1010#SLICE-021: no long boilerplate sentence is duplicated across discovery notes", async () => {
  assert.deepEqual(
    violationsFor(await loadAssembledProse(), "duplicate_sentence"),
    [],
    "move shared boilerplate to docs/tool-discovery.md instead of pasting it onto every entry."
  );
});
