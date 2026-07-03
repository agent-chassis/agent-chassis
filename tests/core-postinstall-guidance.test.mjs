import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import {
  detectAvailableAgents,
  printPostinstallGuidance,
  renderPostinstallGuidance
} from "../packages/core/scripts/postinstall-guidance.mjs";

function commandDetector(availableCommands) {
  return (command) => availableCommands.has(command);
}

function renderDetectedGuidance(availableCommands) {
  const availability = detectAvailableAgents({
    commandAvailable: commandDetector(new Set(availableCommands))
  });
  return renderPostinstallGuidance(availability);
}

function assertTerseSetupPointer(guidance) {
  assert.match(guidance, /AgentChassis installed\./);
  assert.match(guidance, /Run first-time setup from your consumer repo root:/);
  assert.match(guidance, /^  npx agent-chassis setup$/m);
  assert.equal(guidance.match(/npx agent-chassis setup/g)?.length, 1);
}

function assertNoInlineSetupInstructions(guidance) {
  assert.doesNotMatch(guidance, /```/);
  assert.doesNotMatch(guidance, /\bif \[/);
  assert.doesNotMatch(guidance, /\bthen\b/);
  assert.doesNotMatch(guidance, /\bfi\b/);
  assert.doesNotMatch(guidance, /\bcp\b.*AGENTS\.md/);
  assert.doesNotMatch(guidance, /AGENTS\.md/);
  assert.doesNotMatch(guidance, /Detected setup choices:/);
  assert.doesNotMatch(guidance, /^Claude:$/m);
  assert.doesNotMatch(guidance, /^Codex:$/m);
  assert.doesNotMatch(guidance, /npx wiki bootstrap --profile standard/);
  assert.doesNotMatch(guidance, /npx agent-launch init-config/);
  assert.doesNotMatch(guidance, /npx wiki code-index build --json/);
  assert.doesNotMatch(guidance, /npx agent-launch orchestrator IN-0001/);
}

test("postinstall guidance prints only the Claude branch when only claude is detected", () => {
  const guidance = renderDetectedGuidance(["claude"]);

  assertTerseSetupPointer(guidance);
  assertNoInlineSetupInstructions(guidance);
  assert.match(guidance, /Detected agent CLIs: Claude\./);
  assert.doesNotMatch(guidance, /Codex/);
  assert.doesNotMatch(guidance, /--agent claude or --agent codex/);
});

test("postinstall guidance prints only the Codex branch when only codex is detected", () => {
  const guidance = renderDetectedGuidance(["codex"]);

  assertTerseSetupPointer(guidance);
  assertNoInlineSetupInstructions(guidance);
  assert.match(guidance, /Detected agent CLIs: Codex\./);
  assert.doesNotMatch(guidance, /Claude/);
  assert.doesNotMatch(guidance, /--agent claude or --agent codex/);
});

test("postinstall guidance prints both choices when claude and codex are detected", () => {
  const guidance = renderDetectedGuidance(["claude", "codex"]);

  assertTerseSetupPointer(guidance);
  assertNoInlineSetupInstructions(guidance);
  assert.match(guidance, /Detected agent CLIs: Claude, Codex\./);
  assert.match(guidance, /Use --agent claude or --agent codex to choose non-interactively\./);
});

test("postinstall guidance prints no launch commands when neither supported CLI is detected", () => {
  const guidance = renderDetectedGuidance([]);

  assertTerseSetupPointer(guidance);
  assertNoInlineSetupInstructions(guidance);
  assert.match(guidance, /No supported agent CLI was detected on PATH \(checked: claude, codex\)\./);
  assert.match(guidance, /After installing one, rerun setup or pass --agent claude\|codex\./);
});

test("postinstall guidance is non-mutating and does not throw when detection fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "core-postinstall-guidance-"));
  const originalCwd = process.cwd();
  let output = "";

  try {
    process.chdir(tempDir);
    assert.doesNotThrow(() => {
      printPostinstallGuidance({
        commandAvailable(command) {
          throw new Error(`detection failed for ${command}`);
        },
        stdout: {
          write(chunk) {
            output += chunk;
          }
        }
      });
    });

    assert.deepEqual(await readdir(tempDir), []);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }

  assertTerseSetupPointer(output);
  assertNoInlineSetupInstructions(output);
  assert.match(output, /No supported agent CLI was detected/);
});
