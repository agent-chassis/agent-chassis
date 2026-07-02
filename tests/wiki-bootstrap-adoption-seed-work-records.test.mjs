import test from "node:test";
import assert from "node:assert/strict";

import {
  getStaticIn0001AdoptionSeed,
  getStaticIn0001AdoptionSeedWorkRecords,
  validateWorkRecord
} from "../packages/wiki-core/src/index.mjs";

import { materializeAdoptionWorkRecord } from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { WK0001_TEMPLATE_DATA } from "./wiki-bootstrap-adoption-helpers.mjs";

test("static IN-0001 adoption seed exposes the executable WK-0001 work record seed via helper", () => {
  const records = getStaticIn0001AdoptionSeedWorkRecords();
  assert.ok(Array.isArray(records), "helper must return an array");
  assert.ok(records.length > 0, "adoption seed must carry at least one executable work record");

  const tracker = records.find((record) => record.id === "WK-0001");
  assert.ok(tracker, "executable seed must include the WK-0001 tracker");
  assert.equal(tracker.record_kind, "work_item");
  assert.equal(tracker.work_kind, "implementation");
  assert.equal(tracker.initiative, "IN-0001");

  assert.ok(Array.isArray(tracker.slices) && tracker.slices.length > 0, "tracker must have slices");
  const sliceIds = tracker.slices.map((slice) => slice.id);
  assert.deepEqual(
    sliceIds,
    ["repo-local-agents", "launcher-config", "adoption-verify"],
    "tracker must own repo-local-agents and launcher-config implementation slices plus one adoption-verify review slice"
  );
  assert.ok(
    !sliceIds.includes("mcp-alias-default"),
    "the mcp-alias-default slice must be removed from the seeded tracker"
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

test("WK-0795 seeded WK-0001 has 2 implementation slices plus 1 review slice and no empty-write implementation slice", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const byId = Object.fromEntries(tracker.slices.map((slice) => [slice.id, slice]));

  const implementation = tracker.slices.filter((slice) => slice.work_kind === "implementation");
  const review = tracker.slices.filter((slice) => slice.work_kind === "review");
  assert.equal(implementation.length, 2, "expected exactly two implementation slices");
  assert.equal(review.length, 1, "expected exactly one review slice");

  assert.deepEqual(
    implementation.map((slice) => slice.id).sort(),
    ["launcher-config", "repo-local-agents"],
    "implementation slices must be the repo-local AGENTS.md and launcher-config surfaces"
  );

  assert.equal(byId["mcp-alias-default"], undefined, "mcp-alias-default slice must not exist");
  assert.equal(byId["adoption-docs"], undefined, "adoption-docs slice must not exist (docs/adoption.md is bootstrap-seeded)");

  for (const slice of implementation) {
    assert.ok(
      Array.isArray(slice.write_scope) && slice.write_scope.length > 0,
      `implementation slice ${slice.id} must declare a non-empty write_scope`
    );
  }

  assert.deepEqual(byId["repo-local-agents"].write_scope, ["AGENTS.md"]);
  assert.deepEqual(byId["launcher-config"].write_scope, ["agent-launch.toml"]);

  assert.ok(
    !tracker.write_scope.includes("wiki/.wiki-mcp.json"),
    "tracker write_scope must not include the bootstrap-generated wiki/.wiki-mcp.json"
  );
  assert.ok(
    !tracker.write_scope.includes("docs/adoption.md"),
    "tracker write_scope must not include the bootstrap-seeded docs/adoption.md"
  );
  assert.deepEqual(
    tracker.write_scope.slice().sort(),
    ["AGENTS.md", "agent-launch.toml"],
    "tracker write_scope must be exactly the create/customize surfaces (AGENTS.md and agent-launch.toml)"
  );

  const verify = byId["adoption-verify"];
  assert.equal(verify.work_kind, "review", "adoption-verify must be a review-kind slice");
  assert.deepEqual(verify.write_scope, [], "a review slice may carry an empty write_scope");

  assert.ok(
    Array.isArray(verify.repo_paths),
    "adoption-verify must declare a repo_paths array"
  );
  assert.ok(
    !verify.repo_paths.includes("packages/wiki-core/src/operations/adoption-verify.mjs"),
    "adoption-verify.repo_paths must not reference the agent-chassis package source path"
  );
  for (const checkId of [
    "wiki-retrieval",
    "work-records",
    "generate-lint",
    "graph-impact",
    "dispatch-preflight"
  ]) {
    assert.ok(
      verify.acceptance.criteria.some((c) => c.includes(checkId)),
      `adoption-verify acceptance must name the ${checkId} check`
    );
  }

  assert.ok(
    verify.acceptance.validation.some((v) =>
      /npx -p @agent-chassis\/wiki-cli wiki adoption verify --dir "\$PWD" --json/.test(v)
    ),
    "adoption-verify validation must run the package-qualified `npx -p @agent-chassis/wiki-cli wiki adoption verify --dir \"$PWD\" --json`"
  );

  assert.ok(
    verify.acceptance.validation.every((v) => !/npm run wiki/.test(v)),
    "adoption-verify validation must not require `npm run wiki` (not portable to fresh package installs)"
  );

  assert.ok(
    verify.acceptance.criteria.some((c) => /read-only/i.test(c) && /persisted_evidence|persist/i.test(c)),
    "adoption-verify must assert the graph-impact check is read-only and persists no evidence"
  );

  assert.ok(
    verify.acceptance.criteria.some(
      (c) => /wiki\/\.wiki-mcp\.json|wiki-mcp-alias/i.test(c) && /wiki-mcp-workspace\.v1/i.test(c)
    ),
    "adoption-verify acceptance must confirm the non-gating wiki-mcp-alias informational entry"
  );

  assert.ok(
    verify.acceptance.criteria.some(
      (c) => /status[- ]?bookkeeping/i.test(c) || (/done\/blocked|done or blocked/i.test(c) && /implementation slice/i.test(c))
    ),
    "adoption-verify acceptance must require recorded implementation-slice status bookkeeping"
  );

  assert.ok(
    verify.acceptance.criteria.some((c) => /docs\/adoption\.md/.test(c)),
    "adoption-verify acceptance must confirm the non-gating docs/adoption.md informational entry"
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
  assert.deepEqual(
    ownedKeys.slice().sort(),
    ["adoption-docs", "launcher-config", "repo-local-agents"],
    "owned_work must contain only the current authored/adoption surfaces"
  );
  for (const verificationKey of [
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

test("WK-0784 WK-0001 repo-local-agents slice read_scope points at the seeded local helper template", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const slice = tracker.slices.find((s) => s.id === "repo-local-agents");
  assert.ok(slice, "repo-local-agents slice must exist");

  assert.ok(
    slice.read_scope.includes("wiki/templates/AGENTS.md.boilerplate.md"),
    `repo-local-agents.read_scope must include wiki/templates/AGENTS.md.boilerplate.md; got: ${JSON.stringify(slice.read_scope)}`
  );
  assert.ok(
    !slice.read_scope.includes("docs/agent-wiki-boilerplate.md"),
    "repo-local-agents.read_scope must no longer reference the removed docs/agent-wiki-boilerplate.md"
  );
});

test("WK-0784 WK-0001 repo-local-agents acceptance rejects a stub AGENTS.md outcome", () => {
  const [tracker] = getStaticIn0001AdoptionSeedWorkRecords();
  const slice = tracker.slices.find((s) => s.id === "repo-local-agents");
  const criteria = slice.acceptance.criteria;
  const blob = criteria.join("\n");

  assert.match(
    blob,
    /AGENTS\.md\.boilerplate\.md/,
    "acceptance must require adapting the seeded wiki/templates/AGENTS.md.boilerplate.md helper"
  );
  assert.match(
    blob,
    /not a (minimal )?stub|does NOT satisfy|not a placeholder stub|merely adding a retrieval-first/i,
    "acceptance must explicitly reject a minimal/stub AGENTS.md"
  );

  for (const section of [
    "Core Rule",
    "Tool Authority",
    "Tool Discovery",
    "WK-First Worker Sessions",
    "Coordinator Duties",
    "Canonical Layers"
  ]) {
    assert.ok(
      blob.includes(section),
      `acceptance must name the boilerplate section/concept "${section}" so a stub cannot pass`
    );
  }

  assert.match(
    blob,
    /\[repo-name\]|placeholder/i,
    "acceptance must require no unresolved placeholder remains"
  );

  assert.ok(
    criteria.some(
      (c) => /install\/bootstrap|bootstrap command/i.test(c) && /AGENTS\.md/.test(c)
    ),
    "acceptance must require install/bootstrap command instructions stay out of AGENTS.md"
  );
});
