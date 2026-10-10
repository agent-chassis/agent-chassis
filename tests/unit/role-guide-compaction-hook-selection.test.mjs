

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  AGENT_ROLE_GUIDES,
  resolveAgentRoleGuideDirectory,
  resolveAgentRoleGuidePath
} from "../../packages/agent-launch-core/src/lib/agent-role-guides.mjs";
import {
  resolveLaunchRoleGuideDirectory,
  resolveLaunchRoleGuidePath
} from "../../packages/agent-launch-cli/src/lib/launch-isolation-plan.mjs";
import {
  ROLE_GUIDE_COMPACTION_HOOK_GUIDE_CLOSE,
  ROLE_GUIDE_COMPACTION_HOOK_GUIDE_OPEN,
  ROLE_GUIDE_COMPACTION_HOOK_INTRODUCTION,
  ROLE_GUIDE_COMPACTION_HOOK_INVALID_REASON,
  ROLE_GUIDE_COMPACTION_HOOK_TIMEOUT_SEC,
  RoleGuideCompactionHookError,
  composeRoleGuideCompactionContext,
  quoteRoleGuideShellWord,
  resolveRoleGuideCompactionHook
} from "../../packages/agent-launch-cli/src/lib/role-guide-compaction-hook.mjs";
import {
  buildClaudeRoleGuideCompactionHookSettings,
  composeClaudeSettingsWithRoleGuideHook,
  withClaudeConfinedSettingsPath
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-claude-launch-support.mjs";

const ROLE_TABLE = Object.freeze({
  worker: "managed-worker",
  reviewer: "reviewer",
  review: "reviewer",
  redteam: "reviewer",
  orch: "orchestrator",
  "orch-resume": "orchestrator"
});

const UNSELECTED_ROLES = Object.freeze([
  null, undefined, "", "orchestrator", "operator", "validation", "Worker", "worker ",
  "__proto__", "constructor", "toString", "hasOwnProperty", 0, {}
]);

const INTRODUCTION = "Role reminder: the following is your role guide. Use it to remember your role and "
  + "relevant working guidance. Explicit operator instructions and repository policy take precedence over "
  + "this guide, including its mandatory wording. This reminder grants no additional tool or filesystem "
  + "permissions.";

const COMMAND_PREFIX = "guide=$(/bin/cat -- ";
const COMMAND_SUFFIX = ` && printf .) && printf '%s\\n%s\\n%s\\n%s\\n' '${INTRODUCTION}' '<role-guide>' `
  + "\"${guide%.}\" '</role-guide>'";

function unquoteShellWord(word) {
  assert.match(word, /^'(?:[^']|'\\'')*'$/u, word);
  return word.slice(1, -1).replaceAll("'\\''", "'");
}

test("compact hooks select one package guide for each confined role", async (t) => {
  await t.test("every confined role selects exactly its package guide through the shared owner", () => {
    for (const [role, guide] of Object.entries(ROLE_TABLE)) {
      const expected = resolveAgentRoleGuidePath(guide);
      const hook = resolveRoleGuideCompactionHook(role);
      assert.equal(resolveLaunchRoleGuidePath(role), expected, role);
      assert.equal(hook.guidePath, expected, role);
      assert.equal(path.dirname(hook.guidePath), resolveLaunchRoleGuideDirectory(role), role);
      assert.equal(path.dirname(hook.guidePath), resolveAgentRoleGuideDirectory(), role);
      assert.equal(path.isAbsolute(hook.guidePath), true, role);
      assert.equal(Object.isFrozen(hook), true, role);

      assert.equal(hook.command, `${COMMAND_PREFIX}'${expected}'${COMMAND_SUFFIX}`, role);
      assert.equal(hook.command.split(INTRODUCTION).length, 2, `${role}: one introduction`);
      assert.equal(hook.command.split(expected).length, 2, `${role}: one read of one file`);
      assert.equal(hook.command.split("/bin/cat").length, 2, `${role}: one reader`);
      assert.equal(/[\u0000-\u001f\u007f]/u.test(hook.command), false, `${role}: one line`);
      for (const other of AGENT_ROLE_GUIDES.filter((name) => name !== guide)) {
        assert.equal(hook.command.includes(`${other}.md`), false, `${role} never names ${other}`);
      }
    }
    assert.deepEqual([...new Set(Object.values(ROLE_TABLE))].sort(), [...AGENT_ROLE_GUIDES].sort(),
      "every shipped guide is selected by some confined role");
  });

  await t.test("roles outside the table select no guide and no hook", () => {
    for (const role of UNSELECTED_ROLES) {
      assert.equal(resolveLaunchRoleGuidePath(role), null, String(role));
      assert.equal(resolveLaunchRoleGuideDirectory(role), null, String(role));
      assert.equal(resolveRoleGuideCompactionHook(role), null, String(role));
      assert.equal(buildClaudeRoleGuideCompactionHookSettings(role), null, String(role));
    }
  });

  await t.test("the guide arrives once, complete and unchanged, under the introduction and inside delimiters", () => {
    assert.equal(ROLE_GUIDE_COMPACTION_HOOK_INTRODUCTION, INTRODUCTION);
    assert.equal(ROLE_GUIDE_COMPACTION_HOOK_GUIDE_OPEN, "<role-guide>");
    assert.equal(ROLE_GUIDE_COMPACTION_HOOK_GUIDE_CLOSE, "</role-guide>");

    assert.match(INTRODUCTION, /Explicit operator instructions and repository policy take precedence over this guide/u);
    assert.match(INTRODUCTION, /grants no additional tool or filesystem permissions/u);
    assert.equal(INTRODUCTION.includes("'"), false, "the introduction needs no shell escaping");
    for (const guide of ["GUIDE\n", "no final newline", "trailing blank lines\n\n\n", "", "MUST $HOME `id` 'q' \\n %s\n"]) {
      const context = composeRoleGuideCompactionContext(guide);
      assert.equal(context, `${INTRODUCTION}\n<role-guide>\n${guide}\n</role-guide>\n`, JSON.stringify(guide));
      assert.equal(context.split(INTRODUCTION).length, 2, "one introduction");
      assert.equal(context.startsWith(INTRODUCTION), true, "the introduction comes first");
    }
  });

  await t.test("the hook is one SessionStart handler that matches only a compaction", () => {
    const hook = resolveRoleGuideCompactionHook("worker");
    assert.equal(hook.event, "SessionStart");
    assert.equal(hook.matcher, "^compact$");
    assert.equal(hook.timeoutSec, ROLE_GUIDE_COMPACTION_HOOK_TIMEOUT_SEC);
    const matcher = new RegExp(hook.matcher, "u");
    assert.equal(matcher.test("compact"), true);
    for (const source of ["startup", "resume", "clear", "compaction", "precompact", "compact ", "Compact", ""]) {
      assert.equal(matcher.test(source), false, source);
    }
  });

  await t.test("the read command quotes any path so the shell sees exactly that one file", () => {
    for (const guidePath of [
      "/opt/launcher pkg/role guides/orchestrator.md",
      "/opt/it's/\"quoted\"/orchestrator.md",
      "/opt/$HOME/$(id)/`id`/orchestrator.md",
      "/opt/ünïcödé/指南/orchestrator.md",
      "/opt/a;b|c&d>e<f*g?h[i]{j}~k#l!m\\n/orchestrator.md",
      "/opt/''/'"
    ]) {
      const hook = resolveRoleGuideCompactionHook("orch", { resolveGuidePath: () => guidePath });
      assert.equal(hook.guidePath, guidePath);
      assert.equal(hook.command.startsWith(COMMAND_PREFIX), true, guidePath);
      assert.equal(hook.command.endsWith(COMMAND_SUFFIX), true, guidePath);
      const word = hook.command.slice(COMMAND_PREFIX.length, -COMMAND_SUFFIX.length);
      assert.equal(unquoteShellWord(word), guidePath, guidePath);
      assert.equal(quoteRoleGuideShellWord(guidePath), word);
    }
  });

  await t.test("the selection ignores everything except the trusted launch role", () => {
    const seen = [];
    const hook = resolveRoleGuideCompactionHook("redteam", {
      resolveGuidePath: (...args) => { seen.push(args); return resolveLaunchRoleGuidePath(...args); }
    });
    assert.deepEqual(seen, [["redteam"]], "only the role reaches the guide owner");
    assert.equal(hook.guidePath, resolveAgentRoleGuidePath("reviewer"));
  });

  await t.test("a guide path that cannot be named in a hook refuses with a repairable diagnostic", () => {
    for (const [guidePath, cause] of [
      ["relative/orchestrator.md", /not absolute/u],
      [42, /not absolute/u],
      ["/opt/guides/../guides/orchestrator.md", /not normalized/u],
      ["/opt/line\nbreak/orchestrator.md", /control character/u],
      ["/opt/nul\u0000/orchestrator.md", /control character/u],
      ["/opt/del\u007f/orchestrator.md", /control character/u]
    ]) {
      assert.throws(
        () => resolveRoleGuideCompactionHook("orch", { resolveGuidePath: () => guidePath }),
        (error) => {
          assert.ok(error instanceof RoleGuideCompactionHookError);
          assert.equal(error.code, ROLE_GUIDE_COMPACTION_HOOK_INVALID_REASON);
          assert.match(error.detail.cause, cause);
          assert.equal(error.detail.subject, typeof guidePath === "string" ? guidePath : null);
          assert.equal(error.detail.launch_role, "orch");
          assert.match(error.detail.effects, /not launched/u);
          assert.equal(error.detail.repair.actor, "operator");
          assert.match(error.detail.repair.action, /reinstall the launcher package/u);
          assert.match(error.message, cause);
          return true;
        },
        String(guidePath)
      );
    }
  });

  await t.test("Claude gets one synchronous command hook and keeps every other setting", () => {
    for (const role of Object.keys(ROLE_TABLE)) {
      const hook = resolveRoleGuideCompactionHook(role);
      const fragment = buildClaudeRoleGuideCompactionHookSettings(role);
      assert.deepEqual(fragment, {
        hooks: {
          SessionStart: [{
            matcher: "^compact$",
            hooks: [{ type: "command", command: hook.command, timeout: hook.timeoutSec }]
          }]
        }
      }, role);
    }
    const fragment = buildClaudeRoleGuideCompactionHookSettings("worker");
    const other = { matcher: "startup", hooks: [{ type: "command", command: "true" }] };
    const settings = {
      permissions: { allow: ["Bash"], deny: ["WebFetch"], disableBypassPermissionsMode: "disable" },
      hooks: { SessionStart: [other], PreToolUse: [{ matcher: "Bash", hooks: [] }] },
      model: "kept"
    };
    const before = structuredClone(settings);
    const merged = composeClaudeSettingsWithRoleGuideHook(settings, fragment);
    assert.deepEqual(settings, before, "the source settings are not modified");
    assert.deepEqual(merged.permissions, before.permissions);
    assert.equal(merged.model, "kept");
    assert.deepEqual(merged.hooks.PreToolUse, before.hooks.PreToolUse);
    assert.deepEqual(merged.hooks.SessionStart, [other, ...fragment.hooks.SessionStart]);
    assert.deepEqual(composeClaudeSettingsWithRoleGuideHook({}, fragment), fragment);
  });

  await t.test("only the settings option value is swapped for a confined child", () => {
    const base = "/run/settings.json";
    const confined = "/run/confined-settings.json";
    const args = ["--print", "--settings", base, "--model", base, "--", base];
    assert.deepEqual(
      withClaudeConfinedSettingsPath(args, { settingsPath: base, confinedSettingsPath: confined }),
      ["--print", "--settings", confined, "--model", base, "--", base]);
    assert.deepEqual(args[2], base, "the input argv is not modified");
    for (const swap of [{}, { settingsPath: base }, { settingsPath: base, confinedSettingsPath: base },
      { settingsPath: "/other.json", confinedSettingsPath: confined }]) {
      assert.deepEqual(withClaudeConfinedSettingsPath(args, swap), args);
    }
    assert.deepEqual(
      withClaudeConfinedSettingsPath(["--", "--settings", base], { settingsPath: base, confinedSettingsPath: confined }),
      ["--", "--settings", base], "a prompt that looks like the option is left alone");
  });
});
