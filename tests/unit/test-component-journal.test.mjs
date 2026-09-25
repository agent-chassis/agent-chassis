import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createComponentJournal, measureComponentPhase } from "../helpers/test-component-journal.mjs";
import {
  createGitCommandAccount, gitCommandIdentity, snapshotGitTestFixtureMetrics, startGitCommand
} from "../helpers/git-test-measurement.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";
import { readTimingJournal } from "../helpers/test-timing-journal.mjs";
import { readTestRunContext } from "../helpers/test-run-context.mjs";
import { summarizeTestRun } from "../helpers/test-timing-summary.mjs";

const RUN = "00000000-0000-4000-8000-000000000003";

async function runDirectory(t) {
  const fixture = await createTestFixture({ prefix: "component-journal-" });
  t.after(() => fixture.dispose());
  mkdirSync(path.join(fixture.rootPath, "components"), { mode: 0o700 });
  return fixture.rootPath;
}

function records(runDir) {
  const list = [];
  for (const name of readdirSync(path.join(runDir, "components")).filter((entry) => entry.endsWith(".jsonl"))) {
    readTimingJournal(path.join(runDir, "components", name), { onRecord: (record) => list.push(record) });
  }
  return list;
}

test("spans nest by explicit ids, stay unattributed without a test, and end with their outcome", async (t) => {
  const runDir = await runDirectory(t);
  const journal = createComponentJournal({ runId: RUN, runDir, kind: "unit" });
  const outer = journal.startSpan({ owner: "fixture", kind: "fixture_setup", label: "outer" });
  const inner = journal.startSpan({ owner: "fixture", kind: "phase", label: "copy", parentSpanId: outer.id,
    test: { fullName: "suite > case" } });
  inner.end("ok");
  outer.end("failed", Object.assign(new Error("boom"), { code: "E_BOOM" }));
  outer.end("ok");
  const list = records(runDir);
  assert.equal(list[0].event, "producer_start");
  assert.ok(list[0].coverage.unmeasured.length > 0);
  const starts = list.filter((record) => record.event === "span_start");
  assert.equal(starts[0].attribution, "unattributed");
  assert.deepEqual(starts[1].attribution, { test: "suite > case" });
  assert.equal(starts[1].parent_span_id, starts[0].span_id);
  const ends = list.filter((record) => record.event === "span_end");
  assert.deepEqual(ends.map((record) => [record.outcome, record.error_code]), [["ok", null], ["failed", "E_BOOM"]]);
});

test("the phase wrapper returns or rethrows the operation's own outcome", async () => {
  assert.equal(measureComponentPhase("sync", () => 7), 7);
  assert.equal(await measureComponentPhase("async", async () => 8), 8);
  const primary = new Error("primary");
  assert.throws(() => measureComponentPhase("throws", () => { throw primary; }), (error) => error === primary);
  await assert.rejects(measureComponentPhase("rejects", async () => { throw primary; }),
    (error) => error === primary);
});

test("a journal that cannot be written is visibly failed and never throws", async (t) => {
  const runDir = await runDirectory(t);
  const missing = path.join(runDir, "no-such-run");
  const journal = createComponentJournal({ runId: RUN, runDir: missing });
  const span = journal.startSpan({ owner: "x", kind: "y", label: "z" });
  span.end("ok");
  assert.equal(journal.failure.code, "test_runner.artifact_write_failed.v1");
  assert.equal(existsSync(path.join(missing, "components")), false);
});

test("both Git accounts share one identity rule and outcome vocabulary", () => {
  assert.deepEqual(gitCommandIdentity(["worktree", "add", "--detach", "p"]), { name: "worktree", subcommand: "add" });
  assert.deepEqual(gitCommandIdentity(["--no-pager", "status"]), { name: "status", subcommand: null });
  const account = createGitCommandAccount();
  const before = snapshotGitTestFixtureMetrics();
  for (const [args, outcome] of [[["status"], "ok"], [["rev-parse", "HEAD"], "nonzero"], [["status"], "fault"]]) {
    startGitCommand(args, { source: "unit", account })(outcome);
  }
  const finish = startGitCommand(["commit"], { source: "unit", account });
  finish("ok");
  finish("fault");
  const snapshot = account.snapshot();
  assert.deepEqual([snapshot.commands, snapshot.ok, snapshot.nonzero, snapshot.faults], [4, 2, 1, 1]);
  assert.equal(snapshot.by_command.status.count, 2);
  assert.equal(Object.isFrozen(snapshot.by_command.status), true);
  const after = snapshotGitTestFixtureMetrics();
  assert.equal(after.commands - before.commands, 4, "a command is recorded exactly once");
  assert.equal(after.faults - before.faults, 1);
});

test("under the runner, live Git events reconcile with the owner's own aggregate", (t) => {
  const found = readTestRunContext();
  if (found?.context === undefined) {
    t.skip("no runner run context: run through tests/run-tests.mjs");
    return;
  }
  startGitCommand(["status"], { source: "unit" })("ok");
  const summary = summarizeTestRun({ runDir: found.context.runDir, runId: found.context.runId });
  const mine = readdirSync(path.join(found.context.runDir, "components"))
    .filter((name) => name.includes(`-${process.pid}-`));
  assert.equal(mine.length, 1, "one journal per producing process");
  assert.deepEqual(summary.components.git.unreconciled_producers
    .filter((row) => row.journal === mine[0]), []);
  assert.deepEqual(summary.components.problems.filter((row) => row.journal === mine[0]), []);
});
