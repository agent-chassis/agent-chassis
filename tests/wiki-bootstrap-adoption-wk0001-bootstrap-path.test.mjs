import test from "node:test";
import assert from "node:assert/strict";

import { getStaticIn0001AdoptionSeedWorkRecords } from "../packages/wiki-core/src/index.mjs";
import { materializeAdoptionWorkRecord } from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";

function getWk0001Tracker() {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  assert.equal(tracker.id, "WK-0001");
  return tracker;
}

function gatherText(obj) {
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(obj);
  return out.join("\n");
}

const RETIRED_ADOPTION_REVIEW_UNIT =
  /adoption-verify review|adoption readiness review|findings-only adoption|Tracker for the IN-0001 adoption readiness/i;

function assertCandidatePortableTerminalReview(record, label) {
  const terminal = record.slices.find((slice) => slice.id === "SLICE-002");
  const text = gatherText(terminal.acceptance);
  assert.doesNotMatch(text, /\bnpx\b|\bnpm run\b|wiki\s+(?:lint|adoption verify)|agent-chassis setup/i);
  assert.doesNotMatch(text, /verify adoption readiness/i);
  assert.match(text, /review only candidate-portable facts/i);
  assert.match(text, /exact candidate diff.*root `AGENTS\.md` content.*canonical seeded contracts visible in the candidate/is);
  assert.match(text, /placeholder removal.*repository adaptation.*canonical-layer claims are factual/is);
  assert.match(text, /do not rerun coordinator-only lint, adoption verification, graph-impact, dispatch-readiness, or launcher\/setup checks/i);
  assert.match(text, /absent gitignored, cached, generated, or empty setup surfaces/i);
  for (const surface of [
    ".agent-launch/",
    "wiki/.wiki-mcp.json",
    ".cache/wiki-search/",
    "docs/",
    "empty wiki directories"
  ]) {
    assert.ok(text.includes(surface), `${label} must exclude missing ${surface} from findings`);
  }
}

test("WK-2014 WK-0001 seeds the AGENTS.md implementation and terminal review slices", () => {
  const tracker = getWk0001Tracker();
  const slices = tracker.slices ?? [];
  const byId = Object.fromEntries(slices.map((slice) => [slice.id, slice]));

  assert.deepEqual(
    slices.map((slice) => slice.id),
    ["SLICE-001", "SLICE-002"],
    "WK-0001 must seed SLICE-001 implementation followed by SLICE-002 terminal review"
  );
  for (const slice of slices) {
    assert.match(
      slice.id,
      /^SLICE-\d{3}$/,
      `WK-0001 slice ids must be canonical (no semantic ids); found ${slice.id}`
    );
  }

  const agents = byId["SLICE-001"];
  assert.equal(agents.work_kind, "implementation", "SLICE-001 must be an implementation slice");
  assert.deepEqual(
    agents.write_scope,
    ["AGENTS.md"],
    "SLICE-001 must own root AGENTS.md via write_scope [\"AGENTS.md\"]"
  );
  assert.equal(byId["adoption-verify"], undefined, "adoption verify must not be a WK-0001 review slice");
  assert.ok(
    (agents.read_scope ?? []).includes("wiki/templates/AGENTS.md.boilerplate.md"),
    "SLICE-001 read_scope must include the boilerplate helper it adapts"
  );
  const agentsAcceptance = gatherText(agents.acceptance);
  assert.match(agentsAcceptance, /\[repo-name\]|bracketed placeholder/i, "SLICE-001 acceptance must forbid leftover placeholders");
  assert.match(agentsAcceptance, /not a blind copy|not.*copied verbatim/i, "SLICE-001 acceptance must forbid a blind copy");
  assert.match(agentsAcceptance, /unsupported.*(tool|canonical)/i, "SLICE-001 acceptance must require removing unsupported tool/canonical-layer claims");
  assert.match(agentsAcceptance, /accurate positive inventory of adopted repository surfaces/i);
  assert.match(agentsAcceptance, /bootstrap-established canonical wiki\/work-record coordination and structured wiki MCP capability/i);
  assert.match(agentsAcceptance, /does not claim a populated `docs\/` tree.*not guaranteed by the seed/i);

  assert.match(
    agentsAcceptance,
    /mandatory (?:slice-level )?findings-only review/i,
    "SLICE-001 acceptance must retain explicit mandatory findings-only review"
  );

  const terminalReview = byId["SLICE-002"];
  assert.equal(terminalReview.work_kind, "review");
  assert.equal(terminalReview.review_purpose, "terminal_whole_wk");
  assert.deepEqual(terminalReview.write_scope, []);
  assert.deepEqual(terminalReview.depends_on, ["WK-0001#SLICE-001"]);
  assert.equal(terminalReview.dispatch_intent.intended_agent_role, "reviewer");
  assert.ok(!terminalReview.read_scope.includes("agent-launch.toml"));
  assertCandidatePortableTerminalReview(tracker, "static WK-0001 seed");
  assert.match(
    gatherText(tracker.acceptance),
    /mandatory findings-only review/i,
    "WK-0001 acceptance must state that its implementation slice receives a mandatory findings-only review"
  );

  assert.equal(byId["launcher-config"], undefined, "agent-launch.toml is operator setup, not a seeded worker slice");

  assert.deepEqual(
    tracker.write_scope ?? [],
    ["AGENTS.md"],
    "WK-0001 write_scope must cover the seeded AGENTS.md implementation slice"
  );
  for (const command of tracker.acceptance.validation) {
    assert.match(command, /^Coordinator-only; run from the configured repository root;/);
    assert.match(command, /not a terminal-review command or findings criterion:/);
  }
});

test("WK-1402 WK-0001 seed teaches the advisory AGENTS.md worker-dispatch flow", () => {
  const tracker = getWk0001Tracker();
  const text = gatherText(tracker);

  for (const required of [
    "Root AGENTS.md may not exist yet in a freshly bootstrapped repo.",
    "npx agent-chassis setup",
    "review/adapt `wiki/templates/AGENTS.md.boilerplate.md` into root `AGENTS.md`",
    'npx wiki adoption verify --dir "$PWD" --json'
  ]) {
    assert.ok(text.includes(required), `WK-0001 seed must include: ${required}`);
  }

  for (const required of [
    "primary adoption deliverable",
    "must not skip authoring it",
    "must not write root `AGENTS.md` directly",
    "orchestrator write scope does not include the repo root",
    "WK-0001#SLICE-001",
    'write_scope ["AGENTS.md"]',
    "structured MCP dispatch route",
    "not a blind copy",
    "not current-session operating authority",
    "coordinator-owned read-only verification"
  ]) {
    assert.ok(text.includes(required), `WK-0001 seed must teach: ${required}`);
  }

  assert.doesNotMatch(
    text,
    RETIRED_ADOPTION_REVIEW_UNIT,
    "WK-0001 must not reinstate the adoption-verification review unit or review-only tracker framing"
  );

  assert.doesNotMatch(
    text,
    /optional advisory setup|recommended \(not required\)|treat(ed)? (a )?missing root `?AGENTS\.md`? as advisory unless/i,
    "seed must not frame authoring root AGENTS.md as optional — it is the adoption deliverable"
  );

  assert.ok(
    !text.includes("operator_first_run_prerequisites_missing: AGENTS.md"),
    "missing root AGENTS.md must not be framed as a required dispatch-preflight blocker"
  );
  assert.doesNotMatch(
    text,
    /do not dispatch implementation workers|not dispatch implementation workers or treat the repo as agent-operable/i,
    "seed must not stop dispatch solely because root AGENTS.md is missing"
  );
  assert.doesNotMatch(
    text,
    /boilerplate is (the |your |current-session )?(operating )?authority/i,
    "seed must not treat the boilerplate as current-session operating authority"
  );
  assert.doesNotMatch(
    text,
    /copy the boilerplate into the target repo|blindly copy|copy\/adapt it as an operator\/bootstrap first-run surface/i,
    "WK-0001 seed must not carry stale blind-copy or copy/adapt AGENTS.md wording"
  );
});

test("WK-1747 WK-0001 materializes as a canonical valid tracker", () => {
  const tracker = getWk0001Tracker();
  const materialized = materializeAdoptionWorkRecord(tracker, {
    repo: "example/repo",
    date: "2026-07-24"
  });
  const diagnostics = validateWorkRecord(materialized, {
    sourcePath: "wiki/work-records/WK-0001.json"
  });

  assert.deepEqual(
    diagnostics.filter((diagnostic) => diagnostic.severity !== "warning"),
    [],
    "materialized WK-0001 must pass canonical work-record validation"
  );
  assert.deepEqual(materialized.slices.map((slice) => slice.id), ["SLICE-001", "SLICE-002"]);
  assert.equal(materialized.slices[0].work_kind, "implementation");
  assert.deepEqual(materialized.slices[0].write_scope, ["AGENTS.md"]);
  assert.equal(materialized.slices[0].dispatch_intent.intended_agent_role, "worker");
  assert.equal(materialized.slices[1].work_kind, "review");
  assert.equal(materialized.slices[1].review_purpose, "terminal_whole_wk");
  assert.deepEqual(materialized.slices[1].write_scope, []);
  assert.equal(materialized.slices[1].dispatch_intent.intended_agent_role, "reviewer");
  assertCandidatePortableTerminalReview(materialized, "materialized WK-0001");

  assert.match(
    gatherText(materialized.slices[0].acceptance),
    /mandatory (?:slice-level )?findings-only review/i,
    "the materialized SLICE-001 must retain explicit mandatory findings-only review"
  );
  assert.match(
    gatherText(materialized.slices[0].acceptance),
    /accurate positive inventory.*bootstrap-established canonical wiki\/work-record coordination and structured wiki MCP capability/is,
    "the materialized SLICE-001 must preserve positively known adopted wiki/MCP surfaces"
  );
  assert.doesNotMatch(
    gatherText(materialized),
    RETIRED_ADOPTION_REVIEW_UNIT,
    "the materialized WK-0001 must not reinstate the adoption-verification review unit"
  );
});
