import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { generateAndLint } from "../../packages/wiki-core/src/operations/generate-and-lint.mjs";
import { lintRepo } from "../../packages/wiki-core/src/operations/lint.mjs";
import { loadSessionRoleToolAccessPolicy } from "../../packages/wiki-core/src/lib/tool-discovery/gating.mjs";
import {
  evaluateAgentToolConformance,
  evaluateAgentToolTokenBudgetDebt,
  loadToolDiscoveryManifest
} from "../../packages/wiki-core/src/lib/tool-discovery/descriptor.mjs";
import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import { withTestFixture } from "../helpers/test-fixture.mjs";

const IMPLEMENTATION_FINDING_CODES = Object.freeze([
  "agent_tool_conformance_debt_added",
  "agent_tool_conformance_invalid",
  "agent_tool_notes_budget_debt_added",
  "tool_payload_byte_budget_exceeded"
]);
const SESSION_ROLE_FINDING_CODE_PREFIX = "session_role_policy_";

function implementationFindings(result) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  return findings.filter(
    (finding) =>
      IMPLEMENTATION_FINDING_CODES.includes(finding.code) ||
      String(finding.code || "").startsWith(SESSION_ROLE_FINDING_CODE_PREFIX)
  );
}

async function createWikiFixture(dir) {
  const surfaces = [
    "work-records",
    "issues",
    "initiatives",
    "decisions",
    "sources",
    "areas",
    "templates"
  ];
  await Promise.all([
    mkdir(path.join(dir, "docs"), { recursive: true }),
    ...surfaces.map((surface) => mkdir(path.join(dir, "wiki", surface), { recursive: true }))
  ]);
  await Promise.all(
    ["schema.md", "conventions.md", "catalog.md", "index.md"].map((name) =>
      writeFile(path.join(dir, "wiki", name), `# ${name}\n`, "utf8")
    )
  );
}

function withWikiFixture(fn) {
  return withTestFixture(
    async ({ rootPath }) => {
      await createWikiFixture(rootPath);
      return fn(rootPath);
    },
    { prefix: "wiki-lint-implementation-boundary-" }
  );
}

function workRecordJson({ id, title, ...overrides }) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/app-demo",
    title,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "codex",
    created: "2026-04-13",
    updated: "2026-04-13",
    resolution: "unresolved",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    children: [],
    slices: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
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
    ...overrides
  };
}

function writeWorkRecord(dir, record) {
  return writeFile(
    path.join(dir, "wiki", "work-records", `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

async function measureImplementationDebt() {
  const [descriptor, manifest, policyLoad] = await Promise.all([
    loadToolDiscoveryDescriptor(),
    loadToolDiscoveryManifest(),
    loadSessionRoleToolAccessPolicy()
  ]);
  const conformance = evaluateAgentToolConformance(descriptor, manifest, {
    accessPolicy: policyLoad.policy
  });
  const notes = evaluateAgentToolTokenBudgetDebt(descriptor, manifest).raw_discovery_notes;
  return [
    ...conformance.debt_added,
    ...notes.added_entry_names,
    ...policyLoad.diagnostics.map((diagnostic) => diagnostic.code)
  ];
}

test("implementation-only problems produce no wiki lint finding on either route", async () => {

  const ownedDebt = await measureImplementationDebt();

  await withWikiFixture(async (dir) => {
    const lint = await lintRepo({ dir, includeAllFindings: true });
    assert.deepEqual(
      implementationFindings(lint),
      [],
      `workspace_lint_repo must report no implementation-surface finding (owner-visible debt: ${
        ownedDebt.length
      })`
    );

    const generated = await generateAndLint({ dir, includeAllFindings: true });
    assert.deepEqual(
      implementationFindings(generated),
      [],
      "workspace_generate_and_lint must report no implementation-surface finding"
    );
    assert.equal(
      generated.error_count,
      lint.error_count,
      "both wiki lint routes must report the same error population"
    );
  });
});

test("genuine wiki errors are still reported on either route", async () => {
  await withWikiFixture(async (dir) => {

    await writeWorkRecord(
      dir,
      workRecordJson({
        id: "WK-0001",
        title: "Record With A Broken Read-First Reference",
        read_scope: ["docs/missing-doc.md"]
      })
    );

    const expectWikiError = (result, route) => {
      assert.ok(
        result.findings.some(
          (finding) =>
            finding.path === "wiki/work-records/WK-0001.json" &&
            finding.code === "missing_docs_target" &&
            finding.severity === "error"
        ),
        `${route} must keep reporting missing_docs_target with its existing code and severity`
      );
      assert.equal(result.ok, false, `${route} must fail on a genuine wiki error`);
      assert.deepEqual(
        implementationFindings(result),
        [],
        `${route} must report wiki findings only`
      );
    };

    expectWikiError(
      await lintRepo({ dir, includeAllFindings: true }),
      "workspace_lint_repo"
    );
    expectWikiError(
      await generateAndLint({ dir, includeAllFindings: true }),
      "workspace_generate_and_lint"
    );
  });
});

test("the admission-evidence refresh-route lookup survives the removal", async () => {
  await withWikiFixture(async (dir) => {

    await writeWorkRecord(
      dir,
      workRecordJson({
        id: "WK-0002",
        title: "Record With Outdated Admission Evidence",
        derived_evidence: [
          {
            schema_version: "work-record-admission-derived-evidence.v0",
            decision_kind: "work_unit_atomicity",
            unit: { address: "WK-0002" }
          }
        ]
      })
    );

    const lint = await lintRepo({ dir, includeAllFindings: true });
    const refreshFinding = lint.findings.find(
      (finding) =>
        finding.path === "wiki/work-records/WK-0002.json" && finding.refresh_route
    );
    assert.ok(
      refreshFinding,
      "stale worker-admission derived evidence must still receive refresh guidance"
    );
    assert.equal(
      refreshFinding.refresh_route,
      "workspace_work_record_refresh_admission_metrics"
    );
    assert.equal(refreshFinding.severity, "warning");
    assert.deepEqual(implementationFindings(lint), []);
  });
});
