import test from "node:test";
import assert from "node:assert/strict";

import {
  getStaticIn0001AdoptionSeed,
  getStaticIn0001AdoptionSeedWorkRecords,
  validateWorkRecord
} from "../packages/wiki-core/src/index.mjs";

import { materializeAdoptionWorkRecord } from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { WK0001_TEMPLATE_DATA } from "./wiki-bootstrap-adoption-helpers.mjs";

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

test("static IN-0001 adoption seed exposes the executable WK-0001 work record seed via helper", () => {
  const records = getStaticIn0001AdoptionSeedWorkRecords();
  assert.ok(Array.isArray(records), "helper must return an array");
  assert.ok(records.length > 0, "adoption seed must carry at least one executable work record");

  const tracker = records.find((record) => record.id === "WK-0001");
  assert.ok(tracker, "executable seed must include the WK-0001 tracker");
  assert.equal(tracker.record_kind, "work_item");
  assert.equal(tracker.work_kind, "implementation");
  assert.equal(tracker.initiative, "IN-0001");

  assert.ok(Array.isArray(tracker.slices), "tracker must have slices");
  const sliceIds = tracker.slices.map((slice) => slice.id);
  assert.deepEqual(
    sliceIds,
    ["SLICE-001"],
    "tracker must seed only the canonical SLICE-001 AGENTS.md implementation slice"
  );
  assert.ok(
    !sliceIds.includes("adoption-verify"),
    "the retired adoption-verify review unit must not be seeded (adoption verification is coordinator-owned read-only work)"
  );
  assert.ok(
    !sliceIds.includes("launcher-config"),
    "launcher-config must not be a seeded implementation slice"
  );
  assert.ok(
    !sliceIds.includes("adoption-docs"),
    "the adoption-docs slice must be removed (docs/adoption.md is bootstrap-seeded, not worker-authored)"
  );

  for (const collapsed of [
    "wiki-retrieval",
    "work-records",
    "graph-impact",
    "generate-lint",
    "dispatch-preflight"
  ]) {
    assert.ok(
      !sliceIds.includes(collapsed),
      `the ${collapsed} readiness check must be collapsed into adoption-verify, not a standalone slice`
    );
  }
  for (const slice of tracker.slices) {
    assert.ok(slice.acceptance, `slice ${slice.id} must carry acceptance criteria`);
    assert.ok(Array.isArray(slice.write_scope), `slice ${slice.id} must declare a write_scope`);
  }
});

test("WK-1747 seeded WK-0001 carries only the SLICE-001 AGENTS.md implementation slice", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const byId = Object.fromEntries(tracker.slices.map((slice) => [slice.id, slice]));

  assert.equal(tracker.work_kind, "implementation", "WK-0001 tracker owns the AGENTS.md deliverable");

  const implementation = tracker.slices.filter((slice) => slice.work_kind === "implementation");
  const review = tracker.slices.filter((slice) => slice.work_kind === "review");
  assert.deepEqual(
    implementation.map((slice) => slice.id),
    ["SLICE-001"],
    "the only implementation slice must be the canonical SLICE-001 AGENTS.md slice"
  );

  assert.deepEqual(
    review.map((slice) => slice.id),
    [],
    "WK-0001 must seed no review slice"
  );
  assert.equal(
    byId["adoption-verify"],
    undefined,
    "the retired adoption-verify review unit must not be seeded"
  );

  const agents = byId["SLICE-001"];
  assert.equal(agents.work_kind, "implementation", "SLICE-001 must be an implementation slice");
  assert.deepEqual(agents.write_scope, ["AGENTS.md"], "SLICE-001 owns root AGENTS.md");
  assert.ok(
    (agents.read_scope ?? []).includes("wiki/templates/AGENTS.md.boilerplate.md"),
    "SLICE-001 read_scope must include the boilerplate helper it adapts"
  );

  assert.match(
    gatherText(agents.acceptance),
    /mandatory findings-only review/i,
    "SLICE-001 acceptance must retain its explicit mandatory findings-only review"
  );
  assert.match(
    gatherText(tracker.acceptance),
    /mandatory findings-only review/i,
    "WK-0001 acceptance must state that its implementation slice receives a mandatory findings-only review"
  );

  assert.equal(byId["launcher-config"], undefined, "launcher-config slice must not exist");
  assert.equal(byId["mcp-alias-default"], undefined, "mcp-alias-default slice must not exist");
  assert.equal(byId["adoption-docs"], undefined, "adoption-docs slice must not exist (docs/adoption.md is bootstrap-seeded)");

  assert.deepEqual(tracker.write_scope, ["AGENTS.md"], "tracker write_scope must cover the AGENTS.md implementation slice");

  for (const checkId of [
    "wiki-retrieval",
    "work-records",
    "generate-lint",
    "graph-impact",
    "dispatch-preflight"
  ]) {
    assert.ok(
      tracker.scope.includes(checkId),
      `the WK-0001 tracker scope must still name the ${checkId} adoption check`
    );
  }
  assert.ok(
    tracker.scope.includes("coordinator-owned read-only verification, not a WK-0001 review unit"),
    "adoption verification must stay coordinator-owned read-only verification, not a seeded review unit"
  );

  assert.ok(
    !gatherText(tracker).includes("packages/wiki-core/src/operations/adoption-verify.mjs"),
    "the WK-0001 tracker must not reference the agent-chassis package source path"
  );

  assert.ok(
    tracker.acceptance.criteria.some(
      (c) => /wiki\/\.wiki-mcp\.json|wiki-mcp-alias/i.test(c) && /wiki-mcp-workspace\.v1/i.test(c)
    ),
    "tracker acceptance must confirm the non-gating wiki-mcp-alias informational entry"
  );
  assert.ok(
    tracker.acceptance.criteria.some((c) => /docs\/adoption\.md/.test(c)),
    "tracker acceptance must confirm the bootstrap-seeded docs/adoption.md entry"
  );
  assert.ok(
    tracker.acceptance.criteria.some((c) => /agent-launch\.toml/.test(c)),
    "tracker acceptance must cover operator-provided agent-launch.toml/init-config readiness"
  );
});

test("WK-0795 M1 adoption seed graph-impact check is read-only and not owned work", () => {
  const seed = getStaticIn0001AdoptionSeed();

  assert.equal(
    seed.owned_work.find((work) => work.key === "graph-impact"),
    undefined,
    "graph-impact must not be an owned_work item (it is a read-only adoption-verify check)"
  );

  assert.ok(
    seed.required_checks.some((c) => /read-only graph-impact/i.test(c)),
    "required_checks must enumerate read-only graph-impact checks"
  );
  assert.ok(
    !seed.required_checks.some((c) => /graph-evidence persistence/i.test(c)),
    "required_checks must not require graph-evidence persistence"
  );

  assert.ok(
    seed.required_checks.some(
      (c) => /read-only graph-impact/i.test(c) && /WK-0001#adoption-verify/.test(c)
    ),
    "the graph-impact required check must be attributed to the WK-0001#adoption-verify review"
  );

  const ownedKeys = seed.owned_work.map((work) => work.key);
  assert.deepEqual(ownedKeys.slice().sort(), ["adoption-docs"], "owned_work must not include launcher or AGENTS.md setup");
  for (const verificationKey of [
    "launcher-config",
    "wiki-retrieval",
    "work-records",
    "graph-impact",
    "generate-lint",
    "dispatch-preflight",
    "mcp-alias-default"
  ]) {
    assert.ok(
      !ownedKeys.includes(verificationKey),
      `owned_work must not enumerate the read-only/verification key ${verificationKey}`
    );
  }
});

test("WK-0784 seeded WK-0001 tracker validation references adoption verify, not the per-check command list", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  assert.ok(
    tracker.acceptance.validation.some((v) =>
      /npx -p @agent-chassis\/wiki-cli wiki adoption verify --dir "\$PWD" --json/.test(v)
    ),
    "tracker validation must reference the package-qualified `npx -p @agent-chassis/wiki-cli wiki adoption verify --dir \"$PWD\" --json`"
  );
});

test("WK-0784 seeded WK-0001 validation commands are package-portable (no required `npm run wiki`)", () => {
  const seed = getStaticIn0001AdoptionSeed();
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();

  const requiredCommands = [];
  const collectValidation = (unit) => {
    for (const command of unit?.acceptance?.validation ?? []) {
      requiredCommands.push(command);
    }
  };
  collectValidation(tracker);
  for (const slice of tracker.slices ?? []) {
    collectValidation(slice);
  }

  for (const command of requiredCommands) {
    assert.ok(
      !/npm run wiki/.test(command),
      `required seeded validation command must be package-portable, found bare npm-script form: ${command}`
    );
  }

  const wikiCliCommands = requiredCommands.filter((command) =>
    /\b(adoption verify|lint|generate|build-search-index|validate-dispatch|work-records)\b/.test(command)
  );
  assert.ok(wikiCliCommands.length > 0, "expected at least one seeded wiki CLI validation command");
  for (const command of wikiCliCommands) {
    assert.match(
      command,
      /npx -p @agent-chassis\/wiki-cli wiki /,
      `seeded wiki CLI validation command must be package-qualified: ${command}`
    );
    assert.match(
      command,
      /--dir "\$PWD"/,
      `seeded wiki CLI validation command must pass an explicit --dir "$PWD": ${command}`
    );
  }

  const proseMentions = [tracker.scope, ...(tracker.slices ?? []).map((s) => s.scope)]
    .filter((text) => typeof text === "string" && /npm run wiki/.test(text));
  for (const text of proseMentions) {
    assert.match(
      text,
      /shorthand|optional|if this repo defines/i,
      `prose mention of npm run wiki must be framed as optional shorthand: ${text}`
    );
  }
});

test("getStaticIn0001AdoptionSeedWorkRecords clones the WK-0001 seed and is safe to mutate locally", () => {
  const records = getStaticIn0001AdoptionSeedWorkRecords();
  records[0].title = "mutated tracker title";
  records[0].slices[0].id = "mutated-slice";

  const reread = getStaticIn0001AdoptionSeedWorkRecords();
  assert.notEqual(reread[0].title, "mutated tracker title");
  assert.notEqual(reread[0].slices[0].id, "mutated-slice");
  assert.equal(reread[0].id, "WK-0001");
});

test("WK-0784 IN-0001 seed references the standalone WK-0001 template and carries no inline work-record body", () => {
  const seed = getStaticIn0001AdoptionSeed();

  assert.ok(
    !("seed_work_records" in seed),
    "IN-0001 seed must not carry an inline seed_work_records body (single source of truth lives in the standalone template)"
  );
  assert.ok(
    Array.isArray(seed.seed_work_record_templates),
    "IN-0001 seed must reference work-record templates by file name"
  );
  assert.deepEqual(
    seed.seed_work_record_templates,
    ["WK-0001.adoption-tracker.json"],
    "IN-0001 seed must reference the standalone WK-0001 adoption tracker template"
  );
});

test("WK-0784 standalone WK-0001 template is the single source resolved by the seed helper (no divergent copy)", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();

  assert.deepEqual(
    tracker,
    WK0001_TEMPLATE_DATA,
    "the seed helper must return the standalone WK-0001 template body verbatim"
  );
  assert.equal(WK0001_TEMPLATE_DATA.id, "WK-0001");
  assert.equal(WK0001_TEMPLATE_DATA.record_kind, "work_item");
  assert.equal(WK0001_TEMPLATE_DATA.work_kind, "implementation");
  assert.equal(WK0001_TEMPLATE_DATA.initiative, "IN-0001");
});

test("WK-0784 standalone WK-0001 template validates as a canonical work record after materialization", () => {

  const record = materializeAdoptionWorkRecord(WK0001_TEMPLATE_DATA, {
    repo: "agent-chassis/app-demo",
    date: "2026-01-01"
  });
  assert.equal(record.schema_version, "work-record.v1");
  assert.equal(record.id, "WK-0001");
  const diagnostics = validateWorkRecord(record, {
    sourcePath: "wiki/work-records/WK-0001.json"
  });
  const errors = diagnostics.filter((d) => d.severity !== "warning");
  assert.deepEqual(
    errors,
    [],
    `materialized WK-0001 template must validate clean; got: ${JSON.stringify(errors)}`
  );
});

test("WK-1402 AGENTS.md authoring is the canonical SLICE-001 implementation slice", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const agents = tracker.slices.find((s) => s.id === "SLICE-001");

  assert.ok(agents, "WK-0001 must seed the canonical SLICE-001 AGENTS.md slice");
  assert.equal(agents.work_kind, "implementation", "SLICE-001 must be an implementation slice");
  assert.deepEqual(agents.write_scope, ["AGENTS.md"], "SLICE-001 must own root AGENTS.md");

  assert.ok(
    tracker.slices.every((s) => /^(SLICE-\d{3}|adoption-verify)$/.test(s.id)),
    "WK-0001 slice ids must be canonical (SLICE-### or adoption-verify)"
  );

  const acceptance = gatherText(agents.acceptance);
  assert.match(acceptance, /\[repo-name\]|bracketed placeholder/i, "SLICE-001 must forbid leftover placeholders");
  assert.match(acceptance, /not a blind copy|not.*copied verbatim/i, "SLICE-001 must forbid a blind copy");
  assert.match(acceptance, /unsupported.*(tool|canonical)/i, "SLICE-001 must require removing unsupported tool/canonical-layer claims");
});

test("WK-1747 coordinator-owned read-only adoption verification still confirms AGENTS.md readiness", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();

  assert.equal(
    tracker.slices.find((s) => s.id === "adoption-verify"),
    undefined,
    "adoption verification must not be seeded back as a WK-0001 review slice"
  );
  assert.ok(
    tracker.acceptance.criteria.some((c) => /AGENTS\.md/.test(c) && /repo-adapted/i.test(c)),
    "the WK-0001 contract must confirm AGENTS.md is repo-adapted"
  );
  assert.ok(
    tracker.acceptance.criteria.some(
      (c) => /adoption verify/i.test(c) && /read-only verification/i.test(c)
    ),
    "adoption verify must remain coordinator-owned read-only verification of AGENTS.md readiness"
  );
});

test("WK-1402 seeded IN-0001/WK-0001 teach the advisory AGENTS.md worker-dispatch flow", () => {
  const seed = getStaticIn0001AdoptionSeed();
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const text = `${gatherText(seed)}\n${gatherText(tracker)}`;

  for (const required of [
    "npx agent-chassis setup",
    "review/adapt `wiki/templates/AGENTS.md.boilerplate.md` into root `AGENTS.md`",
    'npx wiki adoption verify --dir "$PWD" --json'
  ]) {
    assert.ok(text.includes(required), `seeded adoption surfaces must include: ${required}`);
  }

  for (const required of [
    "primary adoption deliverable",
    "must not skip authoring it",
    "must not write root `AGENTS.md` directly",
    "orchestrator write scope does not include the repo root",
    "WK-0001#SLICE-001",
    'write_scope ["AGENTS.md"]',
    "structured MCP dispatch route",
    "wiki/templates/AGENTS.md.boilerplate.md",
    "not a blind copy",
    "not current-session operating authority",
    "Dispatch implementation only through scoped `WK-*` slices"
  ]) {
    assert.ok(text.includes(required), `seeded adoption surfaces must teach: ${required}`);
  }

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
    "seeded adoption surfaces must not stop dispatch solely because root AGENTS.md is missing"
  );
  assert.doesNotMatch(
    text,
    /boilerplate is (the |your |current-session )?(operating )?authority/i,
    "seeded adoption surfaces must not treat the boilerplate as current-session authority"
  );
  assert.doesNotMatch(
    text,
    /copy the boilerplate into the target repo|blindly copy|copy\/adapt it as an operator\/bootstrap first-run surface/i,
    "seeded adoption surfaces must not carry stale blind-copy or copy/adapt AGENTS.md wording"
  );
});
