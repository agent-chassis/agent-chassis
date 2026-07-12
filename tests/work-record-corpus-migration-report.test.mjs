

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCorpusMigrationReport } from "../packages/wiki-core/src/lib/work-record-corpus-migration-report.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("buildCorpusMigrationReport surveys the real IN/DEC corpus and reports structured drift", async () => {
  const report = await buildCorpusMigrationReport({ repoRoot: REPO_ROOT });

  console.log("\n=== WK-1449#SLICE-012 corpus migration dry-run report ===");
  console.log(`schema_version: ${report.schema_version}`);
  console.log(`totalExamined:  ${report.totalExamined}`);
  console.log(`cleanCount:     ${report.cleanCount}`);
  console.log(`driftCount:     ${report.driftCount}`);
  console.log(`failureCount:   ${report.failureCount}`);

  if (report.drift.length > 0) {
    console.log("\n--- drift (candidate record failed decision.v1 / initiative.v1) ---");
    for (const entry of report.drift) {
      console.log(`\n[${entry.kind}] ${entry.id}  (${entry.path})`);
      for (const diag of entry.diagnostics) {
        console.log(`    - ${diag.code} @ ${diag.path}: ${diag.message}`);
      }
    }
  } else {
    console.log("\n--- no drift: every examined record validates against its kind spec ---");
  }

  if (report.failures.length > 0) {
    console.log("\n--- load/parse failures ---");
    for (const failure of report.failures) {
      console.log(`  [${failure.kind}] ${failure.id}  (${failure.path}): ${failure.error}`);
    }
  }
  console.log("\n=== end report ===\n");

  assert.equal(
    report.schema_version,
    "corpus-migration-report.v1",
    "report carries the corpus-migration-report.v1 schema version"
  );

  assert.ok(
    Number.isInteger(report.totalExamined) && report.totalExamined > 0,
    "expected the dry-run to examine at least one real IN/DEC record"
  );

  assert.ok(Number.isInteger(report.cleanCount) && report.cleanCount >= 0);
  assert.ok(Number.isInteger(report.driftCount) && report.driftCount >= 0);
  assert.ok(Number.isInteger(report.failureCount) && report.failureCount >= 0);
  assert.equal(
    report.cleanCount + report.driftCount,
    report.totalExamined,
    "every examined (successfully-loaded) record is either clean or drifted"
  );

  assert.ok(Array.isArray(report.drift), "drift is a structured list");
  assert.ok(Array.isArray(report.failures), "failures is a structured list");
  assert.equal(report.driftCount, report.drift.length);
  assert.equal(report.failureCount, report.failures.length);

  for (const entry of report.drift) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.path, "string");
    assert.ok(entry.kind === "decision" || entry.kind === "initiative");
    assert.ok(
      Array.isArray(entry.diagnostics) && entry.diagnostics.length > 0,
      "a drift entry must carry at least one diagnostic"
    );
    for (const diag of entry.diagnostics) {
      assert.equal(typeof diag.code, "string");

      assert.ok(diag.path === null || typeof diag.path === "string");
      assert.equal(typeof diag.message, "string");
    }
  }

  for (const failure of report.failures) {
    assert.equal(typeof failure.id, "string");
    assert.equal(typeof failure.path, "string");
    assert.ok(failure.kind === "decision" || failure.kind === "initiative");
    assert.equal(typeof failure.error, "string");
  }
});
