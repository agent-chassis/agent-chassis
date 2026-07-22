import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run } from "../packages/wiki-cli/src/run.mjs";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRecord() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9203",
    repo: "agent-chassis/agent-chassis",
    title: "Edit command fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-05-01",
    updated: "2026-05-01",
    initiative: "IN-0011",
    area: "wiki-mcp",
    read_scope: ["docs/work-record-schema.md"],
    repo_paths: ["packages/wiki-cli/src/commands/work-records.mjs"],
    write_scope: ["packages/wiki-cli/src/commands/work-records.mjs"],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Edit commands are covered."],
      validation: ["npm test -- tests/work-record-edit-commands.test.mjs"]
    },
    sections: {
      summary: "Fixture.",
      why_it_matters: "Fixture.",
      scope: {
        items: ["edit commands"],
        out_of_scope: ["other work"]
      },
      tasks: [
        {
          text: "Record task",
          status: "todo"
        },
        {
          text: "Duplicate task",
          status: "todo"
        },
        {
          text: "Duplicate task",
          status: "todo"
        },
        {
          text: "Already done",
          status: "done"
        },
        {
          text: "--needs review",
          status: "todo"
        }
      ],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: {
        summary: "Old summary",
        validation: ["old validation"],
        follow_ups: ["old follow-up"],
        blockers: ["legacy blocker"]
      }
    },
    children: [],
    slices: [
      {
        id: "edit-command-cli-core",
        title: "CLI core",
        work_kind: "implementation",
        status: "todo",
        priority: "high",
        owner: "codex",
        read_scope: ["docs/work-record-schema.md"],
        repo_paths: ["packages/wiki-cli/src/commands/work-records.mjs"],
        write_scope: ["packages/wiki-cli/src/commands/work-records.mjs"],
        depends_on: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        },
        acceptance: {
          criteria: ["Slice edit commands are covered."],
          validation: ["npm test -- tests/work-record-edit-commands.test.mjs"]
        },
        expected_changed_line_budget: 20,
        sections: {
          summary: "Slice fixture.",
          scope: {
            items: ["slice commands"],
            out_of_scope: ["other work"]
          },
          tasks: [
            {
              text: "Slice task",
              status: "todo"
            },
            {
              text: "Already done",
              status: "done"
            }
          ],
          closure: {
            summary: "Old slice summary",
            validation: ["old slice validation"],
            follow_ups: ["old slice follow-up"],
            blockers: ["legacy slice blocker"]
          }
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

async function setupRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wk-edit-"));
  const recordPath = path.join(dir, "wiki/work-records/WK-9203.json");
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(buildRecord(), null, 2)}\n`);
  return {
    dir,
    recordPath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function runWiki(args, { dir, expectFailure = false } = {}) {
  const lines = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...values) => {
    lines.push(values.join(" "));
  };
  try {
    await run([...args, "--dir", dir, "--json"]);
  } finally {
    console.log = originalLog;
  }

  const stdout = lines.join("\n");
  const status = process.exitCode ? Number(process.exitCode) : 0;
  if (originalExitCode === undefined) {
    process.exitCode = undefined;
  } else {
    process.exitCode = originalExitCode;
  }

  if (expectFailure) {
    assert.notEqual(status, 0, `expected failure, got success: ${stdout}`);
    return {
      status,
      stdout,
      stderr: "",
      json: stdout ? JSON.parse(stdout) : null
    };
  }

  assert.equal(status, 0, `expected success, got failure: ${stdout}`);
  return {
    status,
    stdout,
    stderr: "",
    json: JSON.parse(stdout)
  };
}

async function runWikiText(args, { dir, expectFailure = false } = {}) {
  const lines = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...values) => {
    lines.push(values.join(" "));
  };
  try {
    await run([...args, "--dir", dir]);
  } finally {
    console.log = originalLog;
  }

  const stdout = lines.join("\n");
  const status = process.exitCode ? Number(process.exitCode) : 0;
  if (originalExitCode === undefined) {
    process.exitCode = undefined;
  } else {
    process.exitCode = originalExitCode;
  }

  if (expectFailure) {
    assert.notEqual(status, 0, `expected failure, got success: ${stdout}`);
  } else {
    assert.equal(status, 0, `expected success, got failure: ${stdout}`);
  }

  return {
    status,
    stdout,
    stderr: ""
  };
}

async function runHelp(args) {
  const lines = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...values) => {
    lines.push(values.join(" "));
  };
  try {
    await run(args);
  } finally {
    console.log = originalLog;
    if (originalExitCode === undefined) {
      process.exitCode = undefined;
    } else {
      process.exitCode = originalExitCode;
    }
  }
  return `${lines.join("\n")}\n`;
}

async function readRecord(recordPath) {
  return JSON.parse(await readFile(recordPath, "utf8"));
}

function topLevelKeyOrder(raw) {
  return raw
    .split("\n")
    .map((line) => /^  "([^"]+)":/.exec(line)?.[1])
    .filter(Boolean);
}

function firstSliceKeyOrder(raw) {
  const start = raw.indexOf('  "slices": [');
  assert.notEqual(start, -1);
  const tail = raw.slice(start);
  const objectStart = tail.indexOf("    {");
  assert.notEqual(objectStart, -1);
  const afterObject = tail.slice(objectStart);
  const objectEnd = afterObject.indexOf("\n    }");
  assert.notEqual(objectEnd, -1);
  return afterObject
    .slice(0, objectEnd)
    .split("\n")
    .map((line) => /^      "([^"]+)":/.exec(line)?.[1])
    .filter(Boolean);
}

async function recordTmpEntries(dir) {
  const entries = await readdir(path.join(dir, "wiki/work-records"));
  return entries.filter((entry) => entry.startsWith(".record-tmp-"));
}

test("set-status updates records and slices with deterministic JSON output and key order", async () => {
  const repo = await setupRepo();
  try {
    const before = await readFile(repo.recordPath, "utf8");
    const beforeTopKeys = topLevelKeyOrder(before);
    const beforeSliceKeys = firstSliceKeyOrder(before);

    const beforeNoopStat = await stat(repo.recordPath);
    const statusNoop = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "todo"],
      { dir: repo.dir }
    );
    assert.equal(statusNoop.json.no_op, true);
    assert.deepEqual(statusNoop.json.changed_fields, []);
    assert.equal(await readFile(repo.recordPath, "utf8"), before);
    assert.equal((await stat(repo.recordPath)).mtimeMs, beforeNoopStat.mtimeMs);

    const recordResult = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "active"],
      { dir: repo.dir }
    );
    assert.deepEqual(recordResult.json.changed_fields, ["status", "updated"]);
    assert.equal(recordResult.json.unit.slice_id, null);
    assert.equal(recordResult.json.previous.status, "todo");
    assert.equal(recordResult.json.new.status, "active");
    assert.match(recordResult.json.new.updated, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    assert.notEqual(recordResult.json.new.updated, "2026-05-01");

    const sliceResult = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203#edit-command-cli-core", "--status", "review"],
      { dir: repo.dir }
    );
    assert.deepEqual(sliceResult.json.changed_fields, [
      "slices[edit-command-cli-core].status",
      "updated"
    ]);
    assert.equal(sliceResult.json.unit.slice_id, "edit-command-cli-core");

    const idResult = await runWiki(
      ["work-records", "set-status", "--id", "WK-9203", "--status", "blocked"],
      { dir: repo.dir }
    );
    assert.deepEqual(idResult.json.changed_fields, ["status", "updated"]);
    assert.equal(idResult.json.unit.address, "WK-9203");
    assert.equal(idResult.json.unit.slice_id, null);
    assert.equal((await readRecord(repo.recordPath)).status, "blocked");

    const after = await readFile(repo.recordPath, "utf8");
    assert.deepEqual(topLevelKeyOrder(after), beforeTopKeys);
    assert.deepEqual(firstSliceKeyOrder(after), beforeSliceKeys);
    assert.equal(after, `${JSON.stringify(await readRecord(repo.recordPath), null, 2)}\n`);
    assert.match(after, /\n$/);
    assert.doesNotMatch(after, /\n\n$/);
    assert.doesNotMatch(after, /\r\n/);
  } finally {
    await repo.cleanup();
  }
});

test("set-task scopes by unit, handles indexes, trims text, and preserves no-op files", async () => {
  const repo = await setupRepo();
  try {
    const recordByText = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203", "--text", "  Record task  "],
      { dir: repo.dir }
    );
    assert.deepEqual(recordByText.json.changed_fields, ["sections.tasks[0].status", "updated"]);

    const sliceByIndex = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203#edit-command-cli-core", "--index", "0"],
      { dir: repo.dir }
    );
    assert.deepEqual(sliceByIndex.json.changed_fields, [
      "slices[edit-command-cli-core].sections.tasks[0].status",
      "updated"
    ]);

    const beforeNoop = await readFile(repo.recordPath, "utf8");
    const beforeStat = await stat(repo.recordPath);
    const noop = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203", "--text", "Already done"],
      { dir: repo.dir }
    );
    const afterStat = await stat(repo.recordPath);
    assert.equal(noop.json.no_op, true);
    assert.deepEqual(noop.json.changed_fields, []);
    assert.equal(await readFile(repo.recordPath, "utf8"), beforeNoop);
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);

    const ambiguous = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203", "--text", "Duplicate task"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(ambiguous.json.valid, false);
    assert.equal(ambiguous.json.diagnostics[0].code, "ambiguous_task");

    const outOfRange = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203#edit-command-cli-core", "--index", "9"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(outOfRange.json.diagnostics[0].code, "missing_task");

    const dashText = await runWiki(
      ["work-records", "set-task", "--unit", "WK-9203", "--text", "--needs review"],
      { dir: repo.dir }
    );
    assert.deepEqual(dashText.json.changed_fields, ["sections.tasks[4].status", "updated"]);
  } finally {
    await repo.cleanup();
  }
});

test("set-closure supports partial updates, json files, and malformed payload refusals", async () => {
  const repo = await setupRepo();
  const closurePath = path.join(repo.dir, "closure.json");
  const invalidPath = path.join(repo.dir, "invalid.json");
  try {
    const summaryResult = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", "New summary"],
      { dir: repo.dir }
    );
    assert.deepEqual(summaryResult.json.changed_fields, ["sections.closure.summary", "updated"]);
    let record = await readRecord(repo.recordPath);
    assert.equal(record.sections.closure.summary, "New summary");
    assert.deepEqual(record.sections.closure.validation, ["old validation"]);
    assert.deepEqual(record.sections.closure.follow_ups, ["old follow-up"]);
    assert.deepEqual(record.sections.closure.blockers, ["legacy blocker"]);

    const emptySummary = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", ""],
      { dir: repo.dir }
    );
    assert.deepEqual(emptySummary.json.changed_fields, ["sections.closure.summary", "updated"]);
    record = await readRecord(repo.recordPath);
    assert.equal(record.sections.closure.summary, "");
    assert.deepEqual(record.sections.closure.validation, ["old validation"]);
    assert.deepEqual(record.sections.closure.follow_ups, ["old follow-up"]);
    assert.deepEqual(record.sections.closure.blockers, ["legacy blocker"]);

    const dashSummary = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", "--blocked"],
      { dir: repo.dir }
    );
    assert.deepEqual(dashSummary.json.changed_fields, ["sections.closure.summary", "updated"]);
    record = await readRecord(repo.recordPath);
    assert.equal(record.sections.closure.summary, "--blocked");
    assert.deepEqual(record.sections.closure.blockers, ["legacy blocker"]);

    const closureNoopBefore = await readFile(repo.recordPath, "utf8");
    const closureNoopStat = await stat(repo.recordPath);
    const closureNoop = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", "--blocked"],
      { dir: repo.dir }
    );
    assert.equal(closureNoop.json.no_op, true);
    assert.deepEqual(closureNoop.json.changed_fields, []);
    assert.equal(await readFile(repo.recordPath, "utf8"), closureNoopBefore);
    assert.equal((await stat(repo.recordPath)).mtimeMs, closureNoopStat.mtimeMs);

    const arrayFlags = await runWiki(
      [
        "work-records",
        "set-closure",
        "--unit",
        "WK-9203",
        "--validation-json",
        "[\"new validation\"]",
        "--follow-ups-json",
        "[\"new follow-up\"]"
      ],
      { dir: repo.dir }
    );
    assert.deepEqual(arrayFlags.json.changed_fields, [
      "sections.closure.validation",
      "sections.closure.follow_ups",
      "updated"
    ]);
    record = await readRecord(repo.recordPath);
    assert.deepEqual(record.sections.closure.validation, ["new validation"]);
    assert.deepEqual(record.sections.closure.follow_ups, ["new follow-up"]);
    assert.deepEqual(record.sections.closure.blockers, ["legacy blocker"]);

    await writeFile(closurePath, JSON.stringify({ follow_ups: ["json follow-up"] }));
    const jsonResult = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--json-file", closurePath],
      { dir: repo.dir }
    );
    assert.deepEqual(jsonResult.json.changed_fields, ["sections.closure.follow_ups", "updated"]);
    record = await readRecord(repo.recordPath);
    assert.equal(record.sections.closure.summary, "--blocked");
    assert.deepEqual(record.sections.closure.validation, ["new validation"]);
    assert.deepEqual(record.sections.closure.follow_ups, ["json follow-up"]);
    assert.deepEqual(record.sections.closure.blockers, ["legacy blocker"]);

    await writeFile(invalidPath, "{ nope");
    const malformed = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--json-file", invalidPath],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(malformed.json.diagnostics[0].code, "invalid_json");
    assert.equal(malformed.json.diagnostics[0].message, "json-file must be valid JSON");

    for (const payload of [["x"], "x", { blockers: [] }, { validation: "x" }]) {
      await writeFile(closurePath, JSON.stringify(payload));
      const refused = await runWiki(
        ["work-records", "set-closure", "--unit", "WK-9203", "--json-file", closurePath],
        { dir: repo.dir, expectFailure: true }
      );
      assert.equal(refused.json.valid, false);
    }

    const missing = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--json-file", path.join(repo.dir, "missing.json")],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(missing.json.diagnostics[0].code, "closure_json_unreadable");
    assert.equal(missing.json.diagnostics[0].message, "Unable to read closure JSON file");

    const bothInputs = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", "x", "--json-file", closurePath],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(bothInputs.json.diagnostics[0].code, "ambiguous_closure_input");

    record = await readRecord(repo.recordPath);
    record.sections.closure = null;
    const beforeInvalidPartial = `${JSON.stringify(record, null, 2)}\n`;
    await writeFile(repo.recordPath, beforeInvalidPartial);
    const invalidPartial = await runWiki(
      ["work-records", "set-closure", "--unit", "WK-9203", "--summary", "summary only"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(invalidPartial.json.valid, false);
    assert.equal(invalidPartial.json.written, false);
    assert.equal(await readFile(repo.recordPath, "utf8"), beforeInvalidPartial);
  } finally {
    await repo.cleanup();
  }
});

test("selectors and refusals are deterministic and leave files untouched", async () => {
  const repo = await setupRepo();
  try {
    const before = await readFile(repo.recordPath, "utf8");
    const beforeStat = await stat(repo.recordPath);
    const bothSelectors = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203", "--id", "WK-9203", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(bothSelectors.json.diagnostics[0].code, "ambiguous_selector");

    const noSelector = await runWiki(
      ["work-records", "set-status", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(noSelector.json.diagnostics[0].code, "missing_selector");

    const idSlice = await runWiki(
      ["work-records", "set-status", "--id", "WK-9203#edit-command-cli-core", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(idSlice.json.diagnostics[0].code, "invalid_id");

    const looseSlice = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203+edit-command-cli-core", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(looseSlice.json.diagnostics[0].code, "invalid_unit");

    const invalidStatus = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "not-a-status"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(invalidStatus.json.diagnostics[0].code, "invalid_status");

    const missingRecord = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9999", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(missingRecord.json.diagnostics[0].code, "missing_json_record");

    const missingSlice = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203#missing-slice", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(missingSlice.json.diagnostics[0].code, "missing_slice");

    for (const args of [
      ["work-records", "set-status", "--unit", "WK-9203", "--status"],
      ["work-records", "set-status", "--unit", "--status", "active"],
      ["work-records", "set-task", "--unit", "WK-9203", "--text"],
      ["work-records", "set-task", "--unit", "WK-9203", "--index"],
      ["work-records", "set-closure", "--unit", "WK-9203", "--json-file"]
    ]) {
      const missingValue = await runWiki(args, { dir: repo.dir, expectFailure: true });
      assert.equal(missingValue.json.valid, false);
      assert.equal(missingValue.json.diagnostics[0].code, "missing_option");
    }

    const afterStat = await stat(repo.recordPath);
    assert.equal(await readFile(repo.recordPath, "utf8"), before);
    assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
    assert.deepEqual(await recordTmpEntries(repo.dir), []);
  } finally {
    await repo.cleanup();
  }
});

test("write failures return structured diagnostics instead of escaping", async () => {
  const repo = await setupRepo();
  const recordsDir = path.dirname(repo.recordPath);
  try {
    await chmod(recordsDir, 0o555);
    const result = await runWiki(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(result.json.valid, true);
    assert.equal(result.json.written, false);
    assert.equal(result.json.diagnostics[0].code, "work_record_write_failed");
    assert.equal(result.json.diagnostics[0].message, "failed to write canonical work record JSON");

    const textResult = await runWikiText(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "active"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.match(textResult.stdout, /set-status: refused/);
    assert.match(textResult.stdout, /Valid: true/);
    assert.match(textResult.stdout, /Diagnostics: \[\{"code":"work_record_write_failed"/);
  } finally {
    await chmod(recordsDir, 0o755).catch(() => {});
    await repo.cleanup();
  }
});

test("help text names edit commands and contract edits leave admission evidence stale until refresh", async () => {
  const repo = await setupRepo();
  try {
    const help = await runHelp(["work-records", "help"]);
    assert.match(help, /set-status/);
    assert.match(help, /set-task/);
    assert.match(help, /set-closure/);

    for (const subcommand of ["set-status", "set-task", "set-closure"]) {
      const subHelp = await runHelp(["work-records", subcommand, "--help"]);
      assert.match(subHelp, /--unit/);
      assert.match(subHelp, /--id/);
    }
    assert.match(await runHelp(["work-records", "set-status", "--help"]), /--status/);
    assert.match(await runHelp(["work-records", "set-task", "--help"]), /--text/);
    assert.match(await runHelp(["work-records", "set-task", "--help"]), /--index/);
    assert.match(await runHelp(["work-records", "set-closure", "--help"]), /--summary/);
    assert.match(await runHelp(["work-records", "set-closure", "--help"]), /--json-file/);

    await runWiki(["work-records", "refresh-admission-metrics", "--id", "WK-9203"], { dir: repo.dir });

    await runWiki(["work-records", "set-status", "--unit", "WK-9203", "--status", "active"], { dir: repo.dir });
    const afterStatus = await runWiki(["work-records", "admission", "--unit", "WK-9203"], { dir: repo.dir });
    assert.equal(afterStatus.json.admission_refusal, null);

    await runWiki(
      [
        "work-records",
        "set-list-field",
        "--unit",
        "WK-9203",
        "--field",
        "write_scope",
        "--values-json",
        JSON.stringify([
          "packages/wiki-cli/src/commands/work-records.mjs",
          "packages/wiki-cli/src/commands/work-records-edit.mjs"
        ])
      ],
      { dir: repo.dir }
    );
    const afterContractEdit = await runWiki(["work-records", "admission", "--unit", "WK-9203"], { dir: repo.dir });
    assert.equal(
      afterContractEdit.json.admission_refusal?.code,
      "stale_worker_admission_derived_evidence"
    );
    assert.equal(
      afterContractEdit.json.admission_refusal?.refresh_route,
      "workspace_work_record_refresh_admission_metrics"
    );

    await runWiki(["work-records", "refresh-admission-metrics", "--id", "WK-9203"], { dir: repo.dir });
    const afterRefresh = await runWiki(["work-records", "admission", "--unit", "WK-9203"], { dir: repo.dir });
    assert.equal(afterRefresh.json.admission_refusal, null);
  } finally {
    await repo.cleanup();
  }
});

test("WK-0857 upsert-slice allocates the next ordinal for an omitted id and refuses explicit new semantic ids", async () => {
  const repo = await setupRepo();
  try {

    const ordinal = await runWiki(
      [
        "work-records",
        "upsert-slice",
        "--unit",
        "WK-9203",
        "--slice-json",
        JSON.stringify({ title: "Ordinal slice via omitted id" })
      ],
      { dir: repo.dir }
    );
    assert.equal(ordinal.json.written, true);
    assert.equal(ordinal.json.selected_unit.address, "WK-9203");
    const afterOrdinal = await readRecord(repo.recordPath);
    const created = afterOrdinal.slices.find((slice) => slice.id === "SLICE-001");
    assert.ok(created, "omitted slice id must persist the next SLICE-### ordinal");
    assert.equal(created.title, "Ordinal slice via omitted id");

    const before = await readFile(repo.recordPath, "utf8");
    const refused = await runWiki(
      [
        "work-records",
        "upsert-slice",
        "--unit",
        "WK-9203",
        "--slice-json",
        JSON.stringify({ id: "new-semantic", title: "Explicit semantic slice" })
      ],
      { dir: repo.dir, expectFailure: true }
    );
    assert.equal(refused.json.written, false);
    assert.ok(
      refused.json.diagnostics.some(
        (entry) => entry.code === "semantic_slice_id_creation_not_allowed"
      ),
      "explicit new semantic id must be refused with semantic_slice_id_creation_not_allowed"
    );
    assert.equal(
      await readFile(repo.recordPath, "utf8"),
      before,
      "a refused upsert must leave the on-disk record untouched"
    );
  } finally {
    await repo.cleanup();
  }
});

test("text output includes previous values, new values, validity, and diagnostics", async () => {
  const repo = await setupRepo();
  try {
    const success = await runWikiText(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "active"],
      { dir: repo.dir }
    );
    assert.match(success.stdout, /set-status: written/);
    assert.match(success.stdout, /Valid: true/);
    assert.match(success.stdout, /Previous: \{"status":"todo","updated":"2026-05-01"\}/);
    assert.match(success.stdout, /New: \{"status":"active","updated":"[0-9]{4}-[0-9]{2}-[0-9]{2}"\}/);
    assert.match(success.stdout, /Diagnostics: \[\]/);

    const refused = await runWikiText(
      ["work-records", "set-status", "--unit", "WK-9203", "--status", "not-a-status"],
      { dir: repo.dir, expectFailure: true }
    );
    assert.match(refused.stdout, /set-status: refused/);
    assert.match(refused.stdout, /Valid: false/);
    assert.match(refused.stdout, /Previous: \{\}/);
    assert.match(refused.stdout, /New: \{\}/);
    assert.match(refused.stdout, /Diagnostics: \[\{"code":"invalid_status"/);
  } finally {
    await repo.cleanup();
  }
});
