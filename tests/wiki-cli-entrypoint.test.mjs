import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";
import { run as runCli } from "../packages/wiki-cli/src/run.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(repoRoot, "packages", "wiki-cli", "src", "index.mjs");

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-cli-entrypoint-test-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("wiki CLI entrypoint subprocess captures non-empty JSON stdout from a JSON-producing command", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wiki-cli-entrypoint-test" });
    await runCli(["create", "issue", "Entrypoint subprocess probe", "--dir", tempDir]);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      entrypoint,
      "work-records",
      "load",
      "--id",
      "WK-0001",
      "--json",
      "--dir",
      tempDir
    ]);

    assert.equal(stderr, "", "expected no stderr output from successful command");
    assert.ok(stdout.length > 0, "expected non-empty stdout from subprocess");

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.record_id, "WK-0001");
    assert.equal(parsed.record.id, "WK-0001");
  });
});

test("wiki CLI entrypoint subprocess writes deterministic error to stderr and exits nonzero on unknown command", async () => {
  let caught;
  try {
    await execFileAsync(process.execPath, [entrypoint, "nonexistent-command-xyz"]);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "expected execFile to reject when entrypoint exits nonzero");
  assert.notEqual(caught.code, 0, "expected nonzero exit code from unknown command");
  assert.match(
    caught.stderr,
    /^Unknown command: nonexistent-command-xyz/,
    "expected deterministic error message on stderr"
  );
  assert.equal(caught.stdout, "", "expected no stdout output on the error path");
});

test("wiki CLI bootstrap entrypoint seeds IN-0001 adoption initiative and reports created state in output", async () => {
  await withTempDir(async (tempDir) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      entrypoint,
      "bootstrap",
      "--repo",
      "agent-chassis/entrypoint-bootstrap-test",
      "--dir",
      tempDir
    ]);

    assert.equal(stderr, "", "expected no stderr from successful bootstrap");

    assert.match(
      stdout,
      /IN-0001 adoption initiative: created wiki\/initiatives\/IN-0001\.md/,
      "expected created adoption initiative line in output"
    );

    assert.match(
      stdout,
      /Required checks: 5 \| Owned work items: 1/,
      "expected required-checks and owned-work count in output"
    );

    assert.match(stdout, /Owned work:/, "expected owned work key list in output on creation");

    const adoptionRecordsLine = stdout
      .split("\n")
      .find((line) => line.startsWith("Adoption work records:"));
    assert.ok(
      adoptionRecordsLine,
      "expected a dedicated `Adoption work records:` line in first-run output"
    );
    assert.match(
      adoptionRecordsLine,
      /\bWK-0001\b/,
      "expected the Adoption work records line to name WK-0001"
    );
    const ownedWorkLine = stdout
      .split("\n")
      .find((line) => line.trimStart().startsWith("Owned work:"));
    assert.ok(
      ownedWorkLine,
      "expected an `Owned work:` prose list line in first-run output"
    );
    assert.notEqual(
      adoptionRecordsLine,
      ownedWorkLine,
      "expected the Adoption work records line to be a distinct line from the IN-0001 Owned work prose list"
    );
    assert.doesNotMatch(
      ownedWorkLine,
      /\bWK-0001\b/,
      "expected the IN-0001 Owned work prose list to not name WK-0001 (WK-0001 belongs on the Adoption work records line)"
    );
    for (const ownedKey of ["adoption-docs"]) {
      assert.match(
        ownedWorkLine,
        new RegExp(`\\b${ownedKey}\\b`),
        `expected the IN-0001 Owned work prose list to include ${ownedKey}`
      );
    }
    for (const removedOwnedKey of ["repo-local-agents", "launcher-config"]) {
      assert.doesNotMatch(
        ownedWorkLine,
        new RegExp(`\\b${removedOwnedKey}\\b`),
        `expected ${removedOwnedKey} to be operator first-run setup, not IN-0001 owned work`
      );
    }

    const seededPath = path.join(tempDir, "wiki", "initiatives", "IN-0001.md");
    const seeded = await readFile(seededPath, "utf8");
    assert.match(seeded, /\nid: IN-0001\n/, "expected IN-0001 frontmatter id in seeded file");
    assert.ok(
      seeded.includes("Document local adoption choices"),
      "expected seeded IN-0001 to mention adoption docs as owned work"
    );
    for (const removedTitle of [
      "Add repo-local AGENTS guidance",
      "Add repo-local launcher role defaults"
    ]) {
      assert.ok(
        !seeded.includes(removedTitle),
        `expected seeded IN-0001 to not treat operator first-run setup as owned work: ${removedTitle}`
      );
    }
    assert.ok(
      seeded.includes("WK-0001#adoption-verify"),
      "expected seeded IN-0001 to name the WK-0001#adoption-verify review that performs the checks"
    );
    for (const check of [
      "wiki search/read/get-record",
      "read-only graph-impact",
      "dispatch/preflight verification"
    ]) {
      assert.ok(seeded.includes(check), `expected seeded IN-0001 to name the required check: ${check}`);
    }
    for (const ownedTitle of [
      "Review the seeded repo-local MCP workspace declaration",
      "Verify wiki search/read/get-record",
      "Verify read-only graph-impact",
      "Run generate/lint validation",
      "Verify dispatch and preflight"
    ]) {
      assert.ok(
        !seeded.includes(ownedTitle),
        `WK-0795 M1: seeded IN-0001 must not enumerate verification/mcp work as owned: ${ownedTitle}`
      );
    }

    await assert.rejects(
      access(path.join(tempDir, ".agent-runs")),
      /ENOENT/,
      "bootstrap must not create launcher/dispatch runtime artifacts"
    );
    await access(path.join(tempDir, ".cache"));
    await access(path.join(tempDir, ".cache", "wiki-search"));
    await access(path.join(tempDir, ".cache", "wiki-search", "index.json"));
    await access(path.join(tempDir, ".cache", "repo-code-index"));
    const cacheEntries = await readdir(path.join(tempDir, ".cache"));
    assert.deepEqual(
      cacheEntries.sort(),
      ["repo-code-index", "wiki-search"],
      "expected bootstrap to create the initial cache directories"
    );

    await assert.rejects(
      access(path.join(tempDir, "AGENTS.md")),
      /ENOENT/,
      "bootstrap must not create AGENTS.md (target_surface in IN-0001 seed, not bootstrap output)"
    );

    await access(path.join(tempDir, "docs", "adoption.md"));

    assert.match(stdout, /\nNext steps:\n/, "expected a Next steps block in first-run output");

    for (const command of [
      "git status --short",
      "npx agent-chassis setup",
      "git add wiki docs/adoption.md .gitignore AGENTS.md agent-launch.toml",
      'git commit -m "bootstrap wiki adoption surfaces"',
      'npx wiki code-index build --dir "$PWD"',
      "npx agent-launch orchestrator IN-0001",
      "npx -p @agent-chassis/core agent-launch orchestrator IN-0001"
    ]) {
      assert.ok(
        stdout.includes(command),
        `expected Next steps to include the operator command: ${command}`
      );
    }
    assert.doesNotMatch(
      stdout,
      /cp wiki\/templates\/AGENTS\.md\.boilerplate\.md AGENTS\.md/,
      "Next steps must not include stale AGENTS.md copy guidance"
    );
    for (const staleCommand of [
      "npx agent-launch orchestrator IN-0001 --model",
      "npx -p @agent-chassis/core agent-launch orchestrator IN-0001 --model"
    ]) {
      assert.ok(
        !stdout.includes(staleCommand),
        `Next steps must not include stale primary model launch guidance: ${staleCommand}`
      );
    }

    for (const forbidden of [
      "npx codex-orch",
      "npx claude-orch"
    ]) {
      assert.ok(
        !stdout.includes(forbidden),
        `Next steps must not use the non-package-qualified command: ${forbidden}`
      );
    }
    for (const shorthand of ["codex-orch IN-0001", "claude-orch IN-0001"]) {
      assert.ok(
        !stdout.includes(shorthand),
        `Next steps must not include the removed installed shorthand: ${shorthand}`
      );
    }

    assert.match(
      stdout,
      /After the review\/commit checkpoint[\s\S]*?code-index build --dir/,
      "expected a repo-code-index build command gated on the review/commit checkpoint"
    );

    assert.match(
      stdout,
      /WK-0001 is the seeded adoption\s+tracker the orchestrator drives/,
      "expected Next steps to name WK-0001 as the adoption tracker the orchestrator drives"
    );

    assert.match(
      stdout,
      /do not run them by hand/,
      "expected Next steps to say the operator does not run the WK-0001 slices by hand"
    );
    assert.doesNotMatch(
      stdout,
      /WK-0001#repo-local-agents|WK-0001#launcher-config|WK-0001#mcp-alias-default/,
      "Next steps must no longer enumerate removed per-slice setup work the operator completes one by one"
    );

    assert.doesNotMatch(
      stdout,
      /AGENTS\.md[\s\S]{0,120}WK-0001#|WK-0001#[\s\S]{0,120}AGENTS\.md/,
      "AGENTS.md setup must be operator-created/adapted before orchestrator launch, not a WK-0001 worker slice"
    );
    assert.doesNotMatch(
      stdout,
      /agent-launch\.toml[\s\S]{0,120}WK-0001#|WK-0001#[\s\S]{0,120}agent-launch\.toml/,
      "launcher config setup must be operator-created before orchestrator launch, not a WK-0001 worker slice"
    );

    assert.match(
      stdout,
      /seeds the committed docs\/adoption\.md operator guide from a template/,
      "expected Next steps to state bootstrap seeds docs/adoption.md from a template"
    );

    assert.match(
      stdout,
      /does not configure global\s+MCP client settings/,
      "expected Next steps to state bootstrap does not configure global MCP client settings"
    );
    assert.doesNotMatch(
      stdout,
      /does not configure MCP aliases/,
      "stdout must not claim bootstrap does not configure MCP aliases now that it generates wiki/.wiki-mcp.json"
    );

    const wikiMcpLine = stdout
      .split("\n")
      .find((line) => line.startsWith("Wiki MCP declaration:"));
    assert.ok(
      wikiMcpLine,
      "expected a dedicated `Wiki MCP declaration:` line in first-run output"
    );
    assert.match(
      wikiMcpLine,
      /\bcreated\b/,
      "expected the wiki-mcp declaration to report created state on first run"
    );
    assert.match(
      wikiMcpLine,
      /wiki\/\.wiki-mcp\.json/,
      "expected the wiki-mcp declaration line to name wiki/.wiki-mcp.json"
    );
    assert.match(
      wikiMcpLine,
      /gitignored local artifact \(not committed\)/,
      "expected the wiki-mcp declaration line to frame it as a gitignored, not-committed local artifact"
    );

    await access(path.join(tempDir, "wiki", ".wiki-mcp.json"));
    const gitignore = await readFile(path.join(tempDir, ".gitignore"), "utf8");
    assert.ok(
      gitignore
        .split("\n")
        .some((line) => line.trim() === "wiki/.wiki-mcp.json"),
      "expected bootstrap .gitignore to ignore wiki/.wiki-mcp.json"
    );

    const commitsDeclarationLine = stdout
      .split("\n")
      .find(
        (line) =>
          line.includes("wiki/.wiki-mcp.json") &&
          /\b(git add|commit)\b/.test(line)
      );
    assert.equal(
      commitsDeclarationLine,
      undefined,
      "stdout must not tell the operator to commit wiki/.wiki-mcp.json"
    );

    assert.doesNotMatch(
      stdout,
      /repo is now agent.operable|agent.operable after/i,
      "output must not claim the repo is agent-operable after seeding"
    );
  });
});

test("wiki CLI entrypoint wires the adoption verify command and emits the adoption-verify.v1 envelope", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-wiring" });

    let verifyStdout;
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        entrypoint,
        "adoption",
        "verify",
        "--dir",
        tempDir,
        "--json"
      ]);
      verifyStdout = stdout;
    } catch (error) {
      assert.ok(
        error.stdout,
        `adoption verify must emit a JSON envelope even when blocked: ${error?.stderr || error?.message}`
      );
      verifyStdout = error.stdout;
    }
    const envelope = JSON.parse(verifyStdout);
    assert.equal(envelope.schema, "adoption-verify.v1");
    assert.equal(envelope.verdict, "blocked");
    assert.equal(envelope.persisted_evidence, false);
    assert.deepEqual(
      envelope.checks.filter((check) => check.required).map((check) => check.check),
      ["wiki-retrieval", "work-records", "generate-lint", "graph-impact", "dispatch-preflight"]
    );

    const { stdout: help } = await execFileAsync(process.execPath, [entrypoint, "help"]);
    assert.match(help, /\n\s+adoption\s+Structured first-run adoption readiness checks/);
  });
});

test("wiki CLI bootstrap entrypoint Next steps points at adoption verify without claiming agent-operability", async () => {
  await withTempDir(async (tempDir) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      entrypoint,
      "bootstrap",
      "--repo",
      "agent-chassis/adoption-verify-pointer",
      "--dir",
      tempDir
    ]);

    assert.equal(stderr, "", "expected no stderr from successful bootstrap");

    const adoptionVerifyLines = stdout.split("\n");
    const npxWikiVerifyIdx = adoptionVerifyLines.findIndex((line) =>
      line.includes('npx wiki adoption verify --dir "$PWD" --json')
    );
    const npmVerifyIdx = adoptionVerifyLines.findIndex((line) =>
      line.includes("npm run wiki -- adoption verify")
    );
    const coreFallbackIdx = adoptionVerifyLines.findIndex((line) =>
      line.includes('npx -p @agent-chassis/core wiki adoption verify --dir "$PWD" --json')
    );
    assert.ok(
      npxWikiVerifyIdx !== -1,
      "expected Next steps to reference the local npx wiki adoption verify form"
    );
    assert.ok(
      npmVerifyIdx !== -1,
      "expected Next steps to reference the npm-script adoption verify shorthand"
    );
    assert.ok(
      coreFallbackIdx !== -1,
      "expected Next steps to reference the @agent-chassis/core zero-local-script adoption verify fallback"
    );
    assert.ok(
      npxWikiVerifyIdx < npmVerifyIdx && npmVerifyIdx < coreFallbackIdx,
      "expected npx wiki first, optional npm-script shorthand second, and @agent-chassis/core fallback last"
    );

    assert.match(
      adoptionVerifyLines[npmVerifyIdx - 1] || "",
      /optional|when the repo defines/i,
      "expected the npm-script adoption verify form to be labelled an optional shorthand, not the canonical command"
    );

    assert.match(
      stdout,
      /Bootstrap does not run it[\s\S]*?makes no readiness claim/,
      "expected Next steps to state bootstrap does not run adoption verify and makes no readiness claim"
    );

    assert.doesNotMatch(
      stdout,
      /repo is now agent.operable|agent.operable after/i,
      "bootstrap output must not claim the repo is agent-operable after seeding"
    );
  });
});

test("wiki CLI bootstrap entrypoint is idempotent: rerun reports kept and preserves repo-specific edits", async () => {
  await withTempDir(async (tempDir) => {

    await execFileAsync(process.execPath, [
      entrypoint,
      "bootstrap",
      "--repo",
      "agent-chassis/entrypoint-bootstrap-test",
      "--dir",
      tempDir
    ]);

    const seededPath = path.join(tempDir, "wiki", "initiatives", "IN-0001.md");
    const original = await readFile(seededPath, "utf8");
    const edited = `${original}\n## Repo-Specific Adoption Notes\n\n- Local note that must survive rerun.\n`;
    await writeFile(seededPath, edited, "utf8");

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      entrypoint,
      "bootstrap",
      "--repo",
      "agent-chassis/entrypoint-bootstrap-test",
      "--dir",
      tempDir
    ]);

    assert.equal(stderr, "", "expected no stderr from idempotent bootstrap rerun");
    assert.match(
      stdout,
      /IN-0001 adoption initiative: kept wiki\/initiatives\/IN-0001\.md/,
      "expected kept adoption initiative line on rerun"
    );

    const rerunWikiMcpLine = stdout
      .split("\n")
      .find((line) => line.startsWith("Wiki MCP declaration:"));
    assert.ok(
      rerunWikiMcpLine,
      "expected a `Wiki MCP declaration:` line on bootstrap rerun"
    );
    assert.match(
      rerunWikiMcpLine,
      /\b(kept|refreshed)\b/,
      "expected the wiki-mcp declaration to report kept or refreshed state on rerun"
    );
    assert.match(
      rerunWikiMcpLine,
      /gitignored local artifact \(not committed\)/,
      "expected the rerun wiki-mcp declaration line to keep the gitignored, not-committed framing"
    );

    const afterRerun = await readFile(seededPath, "utf8");
    assert.equal(afterRerun, edited, "expected rerun to preserve repo-specific edits exactly");
    assert.ok(
      afterRerun.includes("Local note that must survive rerun."),
      "expected local note to survive rerun"
    );

    const initiativeFiles = (
      await readdir(path.join(tempDir, "wiki", "initiatives"))
    ).filter((name) => /^IN-\d{4}\.md$/.test(name));
    assert.deepEqual(initiativeFiles, ["IN-0001.md"], "expected exactly one initiative file after rerun");

    const contractPath = path.join(tempDir, "wiki", ".wiki-contract.json");
    const contractAfterFirst = JSON.parse(await readFile(contractPath, "utf8"));
    contractAfterFirst.vocab = contractAfterFirst.vocab || {};
    contractAfterFirst.vocab.topics = contractAfterFirst.vocab.topics || {};
    contractAfterFirst.vocab.topics.local = ["custom-local-topic"];
    await writeFile(contractPath, `${JSON.stringify(contractAfterFirst, null, 2)}\n`, "utf8");

    await execFileAsync(process.execPath, [
      entrypoint,
      "bootstrap",
      "--repo",
      "agent-chassis/entrypoint-bootstrap-test",
      "--dir",
      tempDir
    ]);

    const contractAfterRerun = JSON.parse(await readFile(contractPath, "utf8"));
    assert.ok(
      (contractAfterRerun.vocab?.topics?.local || []).includes("custom-local-topic"),
      "expected user-authored vocab.topics.local entry to survive bootstrap rerun"
    );
  });
});
