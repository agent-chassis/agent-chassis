import { codexCompactionOverrides as buildCodexRoleGuideHookConfigOverrides } from "../helpers/role-guide-delivery.mjs";

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  CODEX_ROLE_GUIDE_HOOK_STATE_KEY,

  buildCodexRoleGuideHookIdentity
} from "../../packages/agent-launch-cli/src/lib/codex-role-guide-hook.mjs";
import { hashCodexHookIdentity } from "../../packages/agent-launch-core/src/lib/codex-session-hook-config.mjs";
import { resolveRoleGuideCompactionHook } from
  "../../packages/agent-launch-cli/src/lib/role-guide-compaction-hook.mjs";

const HOOK = Object.freeze({
  event: "SessionStart",
  matcher: "^compact$",
  guidePath: "/opt/guides/orchestrator.md",
  command: "/bin/cat -- '/opt/guides/orchestrator.md'",
  timeoutSec: 30
});

function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function parseInlineToml(text) {
  let at = 0;
  const expect = (char) => { assert.equal(text[at], char, `expected ${char} at ${at} in ${text}`); at += 1; };
  function string() {
    expect("\"");
    let out = "";
    while (text[at] !== "\"") {
      if (text[at] === "\\") {
        if (text[at + 1] === "u") {
          out += String.fromCodePoint(Number.parseInt(text.slice(at + 2, at + 6), 16));
          at += 6;
        } else {
          assert.ok(text[at + 1] === "\"" || text[at + 1] === "\\", `escape ${text[at + 1]}`);
          out += text[at + 1];
          at += 2;
        }
      } else {
        const code = text.codePointAt(at);
        assert.ok(code >= 0x20 && code !== 0x7f, "no raw control character in a TOML string");
        out += String.fromCodePoint(code);
        at += code > 0xffff ? 2 : 1;
      }
    }
    at += 1;
    return out;
  }
  function value() {
    if (text[at] === "\"") return string();
    if (text[at] === "[") {
      at += 1;
      const items = [];
      while (text[at] !== "]") { items.push(value()); if (text[at] === ",") at += 1; }
      at += 1;
      return items;
    }
    if (text[at] === "{") {
      at += 1;
      const table = {};
      while (text[at] !== "}") {
        const key = string();
        expect("=");
        table[key] = value();
        if (text[at] === ",") at += 1;
      }
      at += 1;
      return table;
    }
    const literal = /^(true|false|\d+)/u.exec(text.slice(at))?.[0];
    assert.ok(literal, `literal at ${at} in ${text}`);
    at += literal.length;
    return literal === "true" ? true : literal === "false" ? false : Number(literal);
  }
  const parsed = value();
  assert.equal(at, text.length, "the whole value is consumed");
  return parsed;
}

function splitOverride(override) {
  const eq = override.indexOf("=");
  return { keyPath: override.slice(0, eq), value: parseInlineToml(override.slice(eq + 1)) };
}

test("Codex compact hook trust is scoped to its normalized definition", async (t) => {
  await t.test("the identity is the normalized session_start handler and hashes canonically", () => {
    const identity = buildCodexRoleGuideHookIdentity(HOOK);
    assert.deepEqual(identity, {
      event_name: "session_start",
      matcher: "^compact$",
      hooks: [{
        type: "command",
        command: HOOK.command,
        timeout: 30,
        async: false,
        additionalContextLimit: 0
      }]
    });

    const canonical = "{\"event_name\":\"session_start\",\"hooks\":[{\"additionalContextLimit\":0,"
      + "\"async\":false,\"command\":\"/bin/cat -- '/opt/guides/orchestrator.md'\",\"timeout\":30,"
      + "\"type\":\"command\"}],\"matcher\":\"^compact$\"}";
    assert.equal(hashCodexHookIdentity(identity), sha256(canonical));
    assert.match(hashCodexHookIdentity(identity), /^sha256:[0-9a-f]{64}$/u);

    const reordered = { matcher: identity.matcher, hooks: [Object.fromEntries(
      Object.entries(identity.hooks[0]).reverse())], event_name: identity.event_name };
    assert.equal(hashCodexHookIdentity(reordered), hashCodexHookIdentity(identity));
  });

  await t.test("any edit to the command, matcher, limit, timeout, mode or event changes the hash", () => {
    const base = buildCodexRoleGuideHookIdentity(HOOK);
    const baseHash = hashCodexHookIdentity(base);
    const handler = base.hooks[0];
    const edits = {
      command: { ...base, hooks: [{ ...handler, command: "/bin/cat -- '/opt/guides/reviewer.md'" }] },
      "appended command": { ...base, hooks: [{ ...handler, command: `${handler.command}; id` }] },
      matcher: { ...base, matcher: "compact" },
      "wider matcher": { ...base, matcher: "^(compact|startup)$" },
      limit: { ...base, hooks: [{ ...handler, additionalContextLimit: 1 }] },
      "absent limit": { ...base, hooks: [(({ additionalContextLimit: _limit, ...rest }) => rest)(handler)] },
      timeout: { ...base, hooks: [{ ...handler, timeout: 31 }] },
      async: { ...base, hooks: [{ ...handler, async: true }] },
      event: { ...base, event_name: "session_end" },
      "second handler": { ...base, hooks: [handler, handler] }
    };
    const hashes = new Set([baseHash]);
    for (const [label, identity] of Object.entries(edits)) {
      const hash = hashCodexHookIdentity(identity);
      assert.notEqual(hash, baseHash, label);
      hashes.add(hash);
    }
    assert.equal(hashes.size, Object.keys(edits).length + 1, "every edit has its own hash");
  });

  await t.test("the overrides add one handler and trust only its exact key and hash", () => {
    const overrides = buildCodexRoleGuideHookConfigOverrides("orch", { resolveHook: () => HOOK });
    assert.equal(overrides.length, 2);
    const [events, state] = overrides.map(splitOverride);

    assert.equal(events.keyPath, "hooks.SessionStart");
    assert.equal(state.keyPath, "hooks.state");
    assert.equal(overrides.some((override) => override.startsWith("hooks.state.")), false);
    assert.deepEqual(events.value, [{
      matcher: "^compact$",
      hooks: [{ type: "command", command: HOOK.command, timeout: 30, async: false, additionalContextLimit: 0 }]
    }]);
    assert.equal(CODEX_ROLE_GUIDE_HOOK_STATE_KEY, "/<session-flags>/config.toml:session_start:0:0");
    assert.deepEqual(state.value, {
      [CODEX_ROLE_GUIDE_HOOK_STATE_KEY]: {
        enabled: true,
        trusted_hash: hashCodexHookIdentity(buildCodexRoleGuideHookIdentity(HOOK))
      }
    });

    assert.equal(state.value[CODEX_ROLE_GUIDE_HOOK_STATE_KEY].trusted_hash,
      hashCodexHookIdentity({ event_name: "session_start", ...events.value[0] }));

    const joined = overrides.join("\n");
    for (const forbidden of ["bypass", "trust_level", "projects", "CODEX_HOME", "PreToolUse", "Stop",
      "allow_managed_hooks_only", "features"]) {
      assert.equal(joined.includes(forbidden), false, forbidden);
    }
    assert.equal(joined.match(/additionalContextLimit/gu).length, 1, "the limit is set for this handler only");
  });

  await t.test("each confined role trusts its own guide command and other roles get nothing", () => {
    const seen = new Map();
    for (const role of ["worker", "review", "reviewer", "redteam", "orch", "orch-resume"]) {
      const hook = resolveRoleGuideCompactionHook(role, { registeredTier: "free_local" });
      const [events, state] = buildCodexRoleGuideHookConfigOverrides(role, { registeredTier: "free_local" }).map(splitOverride);
      assert.equal(events.value[0].hooks[0].command, hook.command, role);
      assert.deepEqual(Object.keys(state.value), [CODEX_ROLE_GUIDE_HOOK_STATE_KEY], role);
      assert.equal(state.value[CODEX_ROLE_GUIDE_HOOK_STATE_KEY].trusted_hash,
        hashCodexHookIdentity(buildCodexRoleGuideHookIdentity(hook)), role);
      seen.set(hook.guidePath, state.value[CODEX_ROLE_GUIDE_HOOK_STATE_KEY].trusted_hash);
    }
    assert.equal(seen.size, 3, "three guides");
    assert.equal(new Set(seen.values()).size, 3, "a hash per guide command");
    for (const role of [null, undefined, "", "orchestrator", "operator", "__proto__"]) {
      assert.deepEqual(buildCodexRoleGuideHookConfigOverrides(role, { registeredTier: "free_local" }), [], String(role));
    }
  });

  await t.test("a command with shell and TOML metacharacters survives the encoding unchanged", () => {
    for (const guidePath of [
      "/opt/it's a \"guide\"/$HOME/`id`/orchestrator.md",
      "/opt/back\\slash/ünïcödé/指南/😀/orchestrator.md"
    ]) {
      const hook = resolveRoleGuideCompactionHook("orch", { resolveGuidePath: () => guidePath });
      const [events, state] = buildCodexRoleGuideHookConfigOverrides("orch", { resolveHook: () => hook })
        .map(splitOverride);
      assert.equal(events.value[0].hooks[0].command, hook.command);
      assert.equal(state.value[CODEX_ROLE_GUIDE_HOOK_STATE_KEY].trusted_hash,
        hashCodexHookIdentity({ event_name: "session_start", ...events.value[0] }));
    }
  });
});
