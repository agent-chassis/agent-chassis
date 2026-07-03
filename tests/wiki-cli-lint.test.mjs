import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";
import { run } from "../packages/wiki-cli/src/run.mjs";

const FINDING_COUNT_OVER_COMPACT_LIMIT = 25;

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-cli-lint-test-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeOverLimitLintFixture(tempDir) {
  await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wiki-cli-lint-test" });

  const fixtureDir = path.join(tempDir, "docs", "lint-fixture");
  await mkdir(fixtureDir, { recursive: true });
  for (let index = 1; index <= FINDING_COUNT_OVER_COMPACT_LIMIT; index += 1) {
    const padded = String(index).padStart(2, "0");
    await writeFile(
      path.join(fixtureDir, `artifact-${padded}.log`),
      `disallowed docs artifact ${padded}\n`,
      "utf8"
    );
  }
}

async function captureLintCommand(argv) {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  const stdout = [];
  const warnings = [];
  const errors = [];

  console.log = (...args) => stdout.push(args.map(String).join(" "));
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  console.error = (...args) => errors.push(args.map(String).join(" "));

  try {
    let thrown = null;
    try {
      await run(["lint", ...argv]);
    } catch (error) {
      thrown = error;
    }
    return { stdout, warnings, errors, thrown };
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
}

async function withSimulatedPlatformStatModes(tempDir, platform, statModes, fn) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalStat = fsPromises.stat;

  Object.defineProperty(process, "platform", {
    value: platform,
    enumerable: originalPlatform?.enumerable ?? true,
    configurable: true
  });
  fsPromises.stat = async (targetPath, ...args) => {
    const result = await originalStat(targetPath, ...args);
    const relativePath = path.relative(tempDir, path.resolve(String(targetPath))).replaceAll(path.sep, "/");
    if (statModes.has(relativePath)) {
      result.mode = statModes.get(relativePath);
    }
    return result;
  };
  syncBuiltinESMExports();

  try {
    await fn();
  } finally {
    fsPromises.stat = originalStat;
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", originalPlatform);
  }
}

function suffixFindingLines(lines) {
  return lines.filter((line) =>
    /docs\/lint-fixture\/artifact-\d+\.log: suffix '\.log' is not allowed/.test(line)
  );
}

test("wiki lint default output reports complete totals and recovery hint when findings are compacted", async () => {
  await withTempRepo(async (tempDir) => {
    await writeOverLimitLintFixture(tempDir);

    const result = await captureLintCommand(["--dir", tempDir]);

    assert.ok(result.thrown, "expected lint to fail for the fixture corpus");
    assert.match(
      result.thrown.message,
      /lint failed with 25 error\(s\) and 0 warning\(s\)/,
      "failure summary must report complete totals, not the compact list length"
    );
    assert.equal(
      suffixFindingLines(result.errors).length,
      20,
      "default CLI output should list only the compact finding projection"
    );
    assert.ok(
      !result.errors.some((line) => line.includes("docs/lint-fixture/artifact-25.log")),
      "default compact output should not list every finding"
    );
    assert.ok(
      result.warnings.some((line) =>
        line.includes("compact projection of 20 of 25 total finding(s)")
      ),
      "default output should make the compact projection explicit"
    );
    assert.ok(
      result.warnings.some((line) =>
        line.includes("Next action: fix the listed errors and rerun lint to reveal the remaining findings")
      ),
      "default output should surface the lint operation recovery hint"
    );
    assert.deepEqual(result.stdout, []);
  });
});

test("wiki lint --all lists every finding with no compact cap", async () => {
  await withTempRepo(async (tempDir) => {
    await writeOverLimitLintFixture(tempDir);

    const result = await captureLintCommand(["--dir", tempDir, "--all"]);

    assert.ok(result.thrown, "expected lint to fail for the fixture corpus");
    assert.match(
      result.thrown.message,
      /lint failed with 25 error\(s\) and 0 warning\(s\)/
    );
    assert.equal(
      suffixFindingLines(result.errors).length,
      FINDING_COUNT_OVER_COMPACT_LIMIT,
      "--all should list every finding"
    );
    assert.ok(
      result.errors.some((line) => line.includes("docs/lint-fixture/artifact-25.log")),
      "--all should make findings past the compact limit reachable"
    );
    assert.ok(
      !result.warnings.some((line) => line.includes("compact projection")),
      "--all output should not report compact projection truncation"
    );
    assert.deepEqual(result.stdout, []);
  });
});

test("wiki lint reports the effective standard profile for a clean standard repo", async () => {
  await withTempRepo(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wiki-cli-lint-test" });

    const result = await captureLintCommand(["--dir", tempDir]);

    assert.equal(
      result.thrown,
      null,
      `expected bootstrapped standard repo to lint cleanly:\n${result.errors.join("\n")}`
    );
    assert.ok(
      result.stdout.some((line) => line.startsWith("Lint passed for ")),
      "successful lint output should include the pass summary"
    );
    assert.ok(
      result.stdout.includes("Profile: standard"),
      "successful lint output must report the effective standard profile"
    );
    assert.ok(
      !result.stdout.includes("Profile: undefined"),
      "successful lint output must not expose an undefined profile"
    );
  });
});

test("wiki lint does not report docs mode-bit findings solely from Windows stat semantics", { skip: "WK-1352 is parked for v1" }, async () => {
  await withTempRepo(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wiki-cli-lint-test" });

    await writeFile(
      path.join(tempDir, "docs", "windows-mode-data.json"),
      "{\"portable\":true}\n",
      "utf8"
    );

    await withSimulatedPlatformStatModes(
      tempDir,
      "win32",
      new Map([["docs/windows-mode-data.json", 0o100755]]),
      async () => {
        const result = await captureLintCommand(["--dir", tempDir, "--all"]);

        assert.equal(
          result.thrown,
          null,
          `expected Windows stat-mode simulation to lint cleanly:\n${result.errors.join("\n")}`
        );
        assert.ok(
          !result.errors.some((line) =>
            line.includes("docs/windows-mode-data.json: file has executable mode bit set under docs/")
          ),
          "Windows mode semantics alone must not emit an executable mode-bit finding"
        );
      }
    );
  });
});

test("wiki lint preserves docs executable mode-bit findings under POSIX stat semantics", async () => {
  await withTempRepo(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wiki-cli-lint-test" });

    await writeFile(
      path.join(tempDir, "docs", "posix-mode-data.json"),
      "{\"portable\":true}\n",
      "utf8"
    );

    await withSimulatedPlatformStatModes(
      tempDir,
      "linux",
      new Map([["docs/posix-mode-data.json", 0o100755]]),
      async () => {
        const result = await captureLintCommand(["--dir", tempDir, "--all"]);

        assert.ok(result.thrown, "expected POSIX executable mode-bit lint failure");
        assert.match(
          result.thrown.message,
          /lint failed with 1 error\(s\) and 0 warning\(s\)/
        );
        assert.ok(
          result.errors.some((line) =>
            line.includes("docs/posix-mode-data.json: file has executable mode bit set under docs/")
          ),
          "POSIX executable mode bits must still emit an executable mode-bit finding"
        );
      }
    );
  });
});
