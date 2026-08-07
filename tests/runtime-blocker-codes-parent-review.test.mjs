import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const descriptor = JSON.parse(fs.readFileSync(
  path.join(REPO_ROOT, "packages/wiki-core/data/runtime-blocker-codes.v1.json"),
  "utf8"
));

test("parent-review worker dispatch blocker is coordinator-recoverable and schema-backed", () => {
  assert.equal(descriptor.schema_version, "runtime-blocker-codes.v1");
  assert.ok(Array.isArray(descriptor.code_categories));
  assert.ok(Array.isArray(descriptor.actor_recovery_values));

  const entries = descriptor.codes.filter(
    (entry) => entry.code === "managed_parent_wk_review_blocks_worker_dispatch"
  );
  assert.equal(entries.length, 1);
  const [entry] = entries;

  assert.equal(entry.category, "work_record_readiness");
  assert.equal(entry.actor_recovery, "coordinator");
  assert.equal(entry.blocking, true);
  assert.ok(descriptor.code_categories.includes(entry.category));
  assert.ok(descriptor.actor_recovery_values.includes(entry.actor_recovery));
  assert.match(entry.summary, /parent WK is in whole-WK review/);
  assert.match(entry.detail, /parent WK is at status=review/);
  assert.match(entry.detail, /coordinator must reconcile the parent WK status/);

  for (const code of descriptor.codes) {
    assert.ok(descriptor.code_categories.includes(code.category), `${code.code} category vocabulary`);
    assert.ok(
      descriptor.actor_recovery_values.includes(code.actor_recovery),
      `${code.code} actor recovery vocabulary`
    );
  }
});
