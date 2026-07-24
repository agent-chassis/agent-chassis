

import assert from "node:assert/strict";

import {
  BACKEND_FORBIDDEN_ENVELOPE_TOKENS,
  createWorkspaceAgentDispatchBackend
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";

import {
  buildFamilyExecutorRegistryEntry,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";

export function assertNoForbiddenTokens(envelope, label) {
  const serialized = JSON.stringify(envelope);
  for (const token of BACKEND_FORBIDDEN_ENVELOPE_TOKENS) {
    assert.equal(
      serialized.includes(token),
      false,
      `${label} envelope must not contain forbidden token: ${token}`
    );
  }
}

function defaultFixtureSourceReadFacts(app) {
  if (app === "claude" || app === "codex") {
    return {
      sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
      nativeReadCapability: LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
    };
  }
  return { sourceReadMode: null };
}

function wrapFixtureExecutor(app, candidate) {
  if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {

    if (
      Object.prototype.hasOwnProperty.call(candidate, "sourceReadMode") &&
      candidate.sourceReadMode != null
    ) {
      return candidate;
    }
    return buildFamilyExecutorRegistryEntry({
      executor: candidate.executor,
      ...defaultFixtureSourceReadFacts(app)
    });
  }
  if (typeof candidate !== "function") {
    return candidate;
  }
  return buildFamilyExecutorRegistryEntry({
    executor: candidate,
    ...defaultFixtureSourceReadFacts(app)
  });
}

function wrapFixtureExecutors(options) {
  if (options.launchExecutors && typeof options.launchExecutors === "object") {
    const wrapped = {};
    for (const [app, candidate] of Object.entries(options.launchExecutors)) {
      wrapped[app] = wrapFixtureExecutor(app, candidate);
    }
    return { launchExecutors: wrapped };
  }
  if (typeof options.launchExecutor === "function") {

    return {
      launchExecutor: undefined,
      launchExecutors: { codex: wrapFixtureExecutor("codex", options.launchExecutor) }
    };
  }
  return {};
}

export function createTestDispatchBackend(options = {}) {
  return createWorkspaceAgentDispatchBackend({

    proveAssignedSourceReadable: async () => ({ ok: true, detail: { fixture: true } }),
    ...options,

    ...wrapFixtureExecutors(options)
  });
}
