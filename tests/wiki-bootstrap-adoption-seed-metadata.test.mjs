import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  getStaticIn0001AdoptionSeed,
  renderStaticIn0001AdoptionSeedMarkdown
} from "../packages/wiki-core/src/index.mjs";

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/wiki-core/templates/IN-0001.adoption-seed.json"
);
const TEMPLATE_DATA = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

test("adoption seed template file is valid and has required fields", () => {
  assert.equal(typeof TEMPLATE_DATA.schema_version, "string");
  assert.equal(TEMPLATE_DATA.record_id, "IN-0001");
  assert.equal(TEMPLATE_DATA.record_kind, "initiative");
  assert.ok(Array.isArray(TEMPLATE_DATA.target_surfaces));
  assert.ok(Array.isArray(TEMPLATE_DATA.owned_work));
  assert.ok(Array.isArray(TEMPLATE_DATA.required_checks));
  assert.ok(Array.isArray(TEMPLATE_DATA.non_goals));
});

test("static IN-0001 adoption seed matches the canonical template file", () => {
  const seed = getStaticIn0001AdoptionSeed();
  assert.deepEqual(seed, TEMPLATE_DATA);
});

test("static IN-0001 adoption seed has required metadata fields", () => {
  const seed = getStaticIn0001AdoptionSeed();
  assert.equal(seed.schema_version, "wiki-bootstrap-seed.v1");
  assert.equal(seed.record_id, "IN-0001");
  assert.equal(seed.record_kind, "initiative");
  assert.equal(seed.title, "Adopt the shared wiki contract and agent workflow");
  assert.equal(
    seed.summary,
    "Static, repo-neutral bootstrap seed content for a consuming repository's own IN-0001 adoption plan."
  );
  assert.equal(seed.repo_neutral, true);
  assert.equal(seed.bootstrap_mode, "preserve_existing");
});

test("adoption seed target surfaces cover required bootstrap paths", () => {
  const seed = getStaticIn0001AdoptionSeed();
  const paths = seed.target_surfaces.map((s) => s.path);
  assert.ok(paths.includes("AGENTS.md"), "AGENTS.md must be in target_surfaces");
  assert.ok(paths.includes("wiki/initiatives/IN-0001.md"), "IN-0001.md must be in target_surfaces");
  assert.ok(paths.includes("docs/adoption.md"), "docs/adoption.md must be in target_surfaces");
  for (const surface of seed.target_surfaces) {
    assert.equal(
      surface.write_mode,
      "create_if_missing",
      `${surface.path} must use create_if_missing`
    );
  }
});

test("WK-0795 adoption seed no longer exposes mcp-alias-default as owned work", () => {
  const seed = getStaticIn0001AdoptionSeed();

  const mcpWork = seed.owned_work.find((work) => work.key === "mcp-alias-default");
  assert.equal(mcpWork, undefined, "mcp-alias-default must not appear in owned_work");
  assert.ok(
    !seed.owned_work.some((work) => work.key === "mcp-alias-default"),
    "owned_work must not enumerate mcp-alias-default as actionable work"
  );

  assert.ok(
    !seed.required_checks.some((check) => /repo-local MCP declaration setup/i.test(check)),
    "required_checks must not list 'repo-local MCP declaration setup'"
  );
});

test("static IN-0001 adoption seed is cloned on read and safe to mutate locally", () => {
  const seed = getStaticIn0001AdoptionSeed();
  seed.target_surfaces[0].path = "mutated.md";
  seed.owned_work[0].title = "mutated title";
  seed.required_checks.push("mutated check");
  seed.non_goals[0] = "mutated non-goal";

  const reread = getStaticIn0001AdoptionSeed();

  assert.equal(reread.target_surfaces[0].path, "AGENTS.md");
  assert.equal(reread.owned_work[0].title, "Add repo-local AGENTS guidance");
  assert.deepEqual(reread.required_checks, TEMPLATE_DATA.required_checks);
  assert.deepEqual(reread.non_goals, TEMPLATE_DATA.non_goals);
});

test("rendered adoption markdown contains required sections and MCP guidance", () => {
  const markdown = renderStaticIn0001AdoptionSeedMarkdown();
  assert.match(markdown, /# Adopt the shared wiki contract and agent workflow/);
  assert.match(markdown, /## Target Surfaces/);
  assert.match(markdown, /`AGENTS\.md` \(create_if_missing\): repo-local agent guidance/);
  assert.match(markdown, /`wiki\/initiatives\/IN-0001\.md` \(create_if_missing\): owned adoption plan/);
  assert.match(markdown, /## Owned Work/);
  assert.match(markdown, /Add repo-local AGENTS guidance/);

  assert.doesNotMatch(markdown, /wiki-mcp-workspace\.v1/);
  assert.match(markdown, /## Required Checks/);

  assert.match(markdown, /- wiki search\/read\/get-record checks/);
  assert.match(markdown, /WK-0001#adoption-verify/);
  assert.doesNotMatch(markdown, /- repo-local AGENTS guidance/);
  assert.match(markdown, /## Non-Goals/);
  assert.match(
    markdown,
    /Do not overwrite repo-specific edits or silently clobber existing canonical records\./
  );
  assert.match(markdown, /## Idempotency/);
  assert.match(markdown, /Preserve existing canonical records and repo-specific edits\./);
  assert.match(markdown, /Create missing bootstrap surfaces only\./);
  assert.match(markdown, /Rerun safely without duplicating seeded content\./);
});

test("rendered adoption markdown does not contain forbidden MCP alias/default setup phrasing", () => {
  const markdown = renderStaticIn0001AdoptionSeedMarkdown();
  assert.doesNotMatch(markdown, /Configure MCP workspace alias\/default/i);
  assert.doesNotMatch(markdown, /MCP alias\/default setup/i);
});

test("rendered adoption markdown references the seeded executable WK-0001 work record", () => {
  const markdown = renderStaticIn0001AdoptionSeedMarkdown();
  assert.match(markdown, /## Executable Work Records/);

  assert.match(markdown, /`WK-0001`/);
  assert.match(markdown, /`WK-0001#repo-local-agents`/);

  assert.match(markdown, /seeded canonical work record/i);
});

test("rendered adoption markdown marks owned work as summary-only and not dispatchable", () => {
  const markdown = renderStaticIn0001AdoptionSeedMarkdown();

  assert.match(markdown, /## Owned Work/);
  assert.match(markdown, /Add repo-local AGENTS guidance/);

  assert.match(markdown, /not dispatchable by itself/i);

  const executableIdx = markdown.indexOf("## Executable Work Records");
  const ownedIdx = markdown.indexOf("## Owned Work");
  assert.ok(executableIdx >= 0 && ownedIdx >= 0);
  assert.ok(
    executableIdx < ownedIdx,
    "Executable Work Records must be presented before the Owned Work summary"
  );
});
