

import { createHash } from "node:crypto";

export const CODEX_SESSION_START_EVENT_LABEL = "session_start";
export const CODEX_STOP_EVENT_LABEL = "stop";

const CODEX_HOOK_EVENT_TABLES = Object.freeze({ [CODEX_SESSION_START_EVENT_LABEL]: "SessionStart",
  [CODEX_STOP_EVENT_LABEL]: "Stop" });

export function codexSessionFlagsHookStateKey(groupIndex, eventLabel = CODEX_SESSION_START_EVENT_LABEL) {
  return `/<session-flags>/config.toml:${eventLabel}:${groupIndex}:0`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashCodexHookIdentity(identity) {
  return `sha256:${createHash("sha256").update(canonicalJson(identity), "utf8").digest("hex")}`;
}

function tomlString(value) {
  let out = "\"";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (char === "\"" || char === "\\") out += `\\${char}`;
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

function tomlValue(value) {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean" || Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(",")}]`;
  return `{${Object.entries(value)
    .map(([key, entry]) => `${tomlString(key)}=${tomlValue(entry)}`).join(",")}}`;
}

export function buildCodexSessionStartHookOverrides(identities) {
  const flat = identities.flatMap(({ companions = [], ...identity }) => [identity, ...companions]);
  if (flat.length === 0) return [];
  const state = {};
  const groupsByTable = new Map();
  for (const identity of flat) {
    const table = Object.hasOwn(CODEX_HOOK_EVENT_TABLES, identity.event_name) ? CODEX_HOOK_EVENT_TABLES[identity.event_name] : null;
    if (table === null) throw new TypeError(`no Codex hook table is registered for the event ${String(identity.event_name)}`);
    const groups = groupsByTable.get(table) ?? [];
    groupsByTable.set(table, groups);
    state[codexSessionFlagsHookStateKey(groups.length, identity.event_name)] =
      { enabled: true, trusted_hash: hashCodexHookIdentity(identity) };
    const { event_name: _eventName, ...group } = identity;
    groups.push(group);
  }
  return [...[...groupsByTable].map(([table, groups]) => `hooks.${table}=${tomlValue(groups)}`), `hooks.state=${tomlValue(state)}`];
}
