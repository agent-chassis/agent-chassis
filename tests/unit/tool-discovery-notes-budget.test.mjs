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

let assembledNotesCache = null;

async function loadAssembledNotes() {
  if (assembledNotesCache) {
    return assembledNotesCache;
  }
  const descriptor = await loadToolDiscoveryDescriptor();
  assembledNotesCache = descriptor.tools
    .filter((tool) => typeof tool.notes === "string" && tool.notes.trim().length > 0)
    .map((tool) => ({ tool_name: tool.tool_name, notes: tool.notes }));
  assert.ok(
    assembledNotesCache.length > 0,
    "expected the assembled corpus to carry at least one notes entry to guard"
  );
  return assembledNotesCache;
}

test("WK-1010#SLICE-021: discovery notes stay within the per-entry verbosity budget", async () => {
  const noted = await loadAssembledNotes();
  for (const { tool_name, notes } of noted) {
    assert.ok(
      notes.length <= SLICE_021_MAX_NOTES_CHARS,
      `${tool_name} discovery notes are ${notes.length} chars; per-entry budget is ` +
        `${SLICE_021_MAX_NOTES_CHARS}. Trim to one or two selection caveats rather than ` +
        "regrowing a changelog/schema essay in the notes."
    );
  }
});

test("WK-2194: aggregate discovery-notes budget remains exact after recovery", async () => {
  const [descriptor, manifest] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest()
  ]);
  const report = evaluateAgentToolTokenBudgetDebt(descriptor, manifest).raw_discovery_notes;
  assert.equal(report.target, SLICE_021_MAX_AGGREGATE_NOTES_CHARS);
  assert.equal(report.current_value, 55788);
  assert.equal(report.denominator, 148);
  assert.equal(report.debt_added, 0);
  assert.equal(report.debt_retired, 6213);
  assert.deepEqual(report.added_entry_names, []);
  assert.equal(report.remaining_excess, 0);
  assert.equal(report.within_target, true, "the measured corpus must remain within 62,000 chars");
  assert.equal(report.growth_free, true);
  assert.equal(report.owner, "tool-discovery notes/description budget test family");
  assert.equal(report.target_wk, "WK-2194");
});

test("WK-2253: new or enlarged notes cannot hide behind aggregate reductions", async () => {
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
  enlarged.notes += " Added prose.";
  reduced.notes = reduced.notes.slice(0, -100);
  const report = evaluateAgentToolTokenBudgetDebt(changed, manifest).raw_discovery_notes;
  assert.equal(report.current_value < report.baseline_value, true);
  assert.equal(report.debt_added - baseline.debt_added, " Added prose.".length);
  assert.ok(report.added_entry_names.includes("workspace_tools_list"));
  assert.ok(report.debt_retired >= 100);
  assert.equal(report.growth_free, false);
});

test("WK-1010#SLICE-021: discovery notes carry no WK/SLICE changelog provenance", async () => {
  const noted = await loadAssembledNotes();
  for (const { tool_name, notes } of noted) {
    const notesWithoutWorkedExamples = notes.replace(
      /\b(WK-\d{3,})#SLICE-\d+\b/g,
      "$1"
    );
    const sliceTokens = notesWithoutWorkedExamples.match(/\bSLICE-\d+\b/g);
    assert.equal(
      sliceTokens,
      null,
      `${tool_name} notes must not cite slice provenance (found ${JSON.stringify(sliceTokens)}); ` +
        "notes teach selection, not changelog history."
    );
    const wkIds = [...new Set(notes.match(/\bWK-\d{3,}\b/g) ?? [])];
    assert.ok(
      wkIds.length <= SLICE_021_MAX_DISTINCT_WK_IDS_PER_NOTE,
      `${tool_name} notes cite ${wkIds.length} distinct WK ids (${JSON.stringify(wkIds)}); at most ` +
        `${SLICE_021_MAX_DISTINCT_WK_IDS_PER_NOTE} is allowed as a worked example. Multiple WK ids is ` +
        "the changelog-essay smell — move provenance to the WK record and docs."
    );
  }
});

test("WK-1010#SLICE-021: discovery notes dump no backend/source .mjs module paths", async () => {
  const noted = await loadAssembledNotes();
  for (const { tool_name, notes } of noted) {
    const modulePaths = notes.match(/[\w-]+\.mjs\b/g);
    assert.equal(
      modulePaths,
      null,
      `${tool_name} notes must not dump backend/source module paths (found ${JSON.stringify(modulePaths)}); ` +
        "implementation wiring belongs in source comments and the WK, not selection notes."
    );
  }
});

test("WK-1010#SLICE-021: discovery notes dump no schema/response-shape field inventories", async () => {
  const noted = await loadAssembledNotes();
  for (const { tool_name, notes } of noted) {
    const hit = SLICE_021_BANNED_SCHEMA_TOKENS.find((token) => notes.includes(token));
    assert.equal(
      hit,
      undefined,
      `${tool_name} notes must not inventory response-shape/schema fields (found "${hit}"); ` +
        "keep field/response shapes in docs/tool-discovery.md and the live schema, not the notes."
    );
  }
});

test("WK-1010#SLICE-021: no long boilerplate sentence is duplicated across discovery notes", async () => {

  const noted = await loadAssembledNotes();
  const sentenceToTools = new Map();
  for (const { tool_name, notes } of noted) {
    const sentences = notes
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= SLICE_021_DUP_SENTENCE_MIN_CHARS);
    for (const sentence of sentences) {
      if (!sentenceToTools.has(sentence)) {
        sentenceToTools.set(sentence, new Set());
      }
      sentenceToTools.get(sentence).add(tool_name);
    }
  }
  for (const [sentence, tools] of sentenceToTools) {
    assert.ok(
      tools.size <= SLICE_021_DUP_SENTENCE_MAX_NOTES,
      `the same ${sentence.length}-char sentence is duplicated across ${tools.size} discovery notes ` +
        `(${[...tools].join(", ")}); move shared boilerplate to docs/tool-discovery.md instead of ` +
        `pasting it onto every entry. Sentence: ${JSON.stringify(sentence)}`
    );
  }
});
