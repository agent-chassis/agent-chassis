import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readWorkRecordById } from "@agent-chassis/wiki-core";

import { runDigest, runLoad, runValidate } from "./read-commands.mjs";

const repoRoot = path.resolve(".");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "work-records");

function captureCommandRun(fn) {
  return async () => {
    const previousExitCode = process.exitCode;
    const lines = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => {
      lines.push(
        args
          .map((value) => (typeof value === "string" ? value : String(value)))
          .join(" ")
      );
    };
    console.error = (...args) => {
      lines.push(
        args
          .map((value) => (typeof value === "string" ? value : String(value)))
          .join(" ")
      );
    };

    try {
      process.exitCode = 0;
      await fn();
      return { exitCode: process.exitCode, output: lines.join("\n") };
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.exitCode = previousExitCode;
    }
  };
}

function createFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-read-commands-"));
  fs.mkdirSync(path.join(dir, "wiki", "work-records"), { recursive: true });
  fs.copyFileSync(
    path.join(fixtureRoot, "valid", "minimal.json"),
    path.join(dir, "wiki", "work-records", "WK-9001.json")
  );
  fs.copyFileSync(
    path.join(fixtureRoot, "invalid", "missing-required-field.json"),
    path.join(dir, "wiki", "work-records", "WK-9102.json")
  );
  fs.cpSync(path.join(fixtureRoot, "compatibility", "missing-json", "wiki"), path.join(dir, "wiki"), {
    recursive: true
  });
  return dir;
}

async function expectedLoad(dir, id) {
  return readWorkRecordById({ dir, id, recordStore: null });
}

async function assertJsonCommand({ command, argv, expectedExitCode, expectedJson }) {
  const { exitCode, output } = await captureCommandRun(() => command(argv))();
  assert.equal(exitCode, expectedExitCode);
  assert.deepEqual(JSON.parse(output), expectedJson);
}

test("work-records read commands keep valid JSON exits at zero", async () => {
  const dir = createFixtureRepo();
  const validLoad = await expectedLoad(dir, "WK-9001");

  await assertJsonCommand({
    command: runLoad,
    argv: ["load", "--id", "WK-9001", "--dir", dir, "--json"],
    expectedExitCode: 0,
    expectedJson: validLoad
  });

  await assertJsonCommand({
    command: runDigest,
    argv: ["digest", "--id", "WK-9001", "--dir", dir, "--json"],
    expectedExitCode: 0,
    expectedJson: {
      record_id: validLoad.record_id,
      source_path: validLoad.source_path_relative || validLoad.source_path,
      source_digest: validLoad.source_digest,
      valid: validLoad.valid
    }
  });

  await assertJsonCommand({
    command: runValidate,
    argv: ["validate", "--id", "WK-9001", "--dir", dir, "--json"],
    expectedExitCode: 0,
    expectedJson: {
      valid: validLoad.valid,
      diagnostics: validLoad.diagnostics
    }
  });
});

test("work-records read commands set exitCode for invalid and missing JSON results", async () => {
  const dir = createFixtureRepo();
  const invalidLoad = await expectedLoad(dir, "WK-9102");
  const missingLoad = await expectedLoad(dir, "WK-9111");

  await assertJsonCommand({
    command: runLoad,
    argv: ["load", "--id", "WK-9102", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: invalidLoad
  });

  await assertJsonCommand({
    command: runDigest,
    argv: ["digest", "--id", "WK-9102", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: {
      record_id: invalidLoad.record_id,
      source_path: invalidLoad.source_path_relative || invalidLoad.source_path,
      source_digest: invalidLoad.source_digest,
      valid: invalidLoad.valid
    }
  });

  await assertJsonCommand({
    command: runValidate,
    argv: ["validate", "--id", "WK-9102", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: {
      valid: invalidLoad.valid,
      diagnostics: invalidLoad.diagnostics
    }
  });

  await assertJsonCommand({
    command: runLoad,
    argv: ["load", "--id", "WK-9111", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: missingLoad
  });

  await assertJsonCommand({
    command: runDigest,
    argv: ["digest", "--id", "WK-9111", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: {
      record_id: missingLoad.record_id,
      source_path: missingLoad.source_path_relative || missingLoad.source_path,
      source_digest: missingLoad.source_digest,
      valid: missingLoad.valid
    }
  });

  await assertJsonCommand({
    command: runValidate,
    argv: ["validate", "--id", "WK-9111", "--dir", dir, "--json"],
    expectedExitCode: 1,
    expectedJson: {
      valid: missingLoad.valid,
      diagnostics: missingLoad.diagnostics
    }
  });
});
