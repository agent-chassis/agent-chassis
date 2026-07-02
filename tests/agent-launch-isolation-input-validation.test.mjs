

import test from "node:test";
import assert from "node:assert/strict";

import { buildBubblewrapLaunchPlan } from "../packages/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  CODES,
  repoRoot,
  expectIsolationError
} from "./agent-launch-isolation-helpers.mjs";

test("buildBubblewrapLaunchPlan: refuses missing command", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "" }),
    CODES.COMMAND_INVALID
  );
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot }),
    CODES.COMMAND_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-array args", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", args: "not-array" }),
    CODES.ARGS_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-string arg entry", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", args: ["a", 42] }),
    CODES.ARGS_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-object env", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", env: "PATH=/bin" }),
    CODES.ENV_INVALID
  );
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", env: ["FOO=bar"] }),
    CODES.ENV_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-string env value", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", env: { FOO: 42 } }),
    CODES.ENV_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-plain-object homePolicy", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", homePolicy: ["/etc/ssl"] }),
    CODES.HOME_POLICY_INVALID
  );
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true", homePolicy: "reads" }),
    CODES.HOME_POLICY_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses unknown homePolicy keys", () => {
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        homePolicy: { writes: ["/home/user"] }
      }),
    CODES.HOME_POLICY_INVALID
  );
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        homePolicy: { reads: ["/etc/ssl/certs"], unknown: true }
      }),
    CODES.HOME_POLICY_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-array homePolicy.reads", () => {
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        homePolicy: { reads: "/etc/ssl/certs" }
      }),
    CODES.HOME_POLICY_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses unknown readOnly bind key", () => {
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        readOnlyRoots: [{ src: "/etc/hosts", dst: "/etc/hosts", mode: "ro" }]
      }),
    CODES.BIND_ENTRY_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses bind entry that is neither string nor {src,dst}", () => {
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        readOnlyRoots: [42]
      }),
    CODES.BIND_ENTRY_INVALID
  );
});

test("buildBubblewrapLaunchPlan: refuses non-array writableRoots / runtimeRoots / readOnlyRoots", () => {
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        writableRoots: "docs"
      }),
    CODES.BIND_ENTRY_INVALID
  );
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        runtimeRoots: "/tmp"
      }),
    CODES.BIND_ENTRY_INVALID
  );
  expectIsolationError(
    () =>
      buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        readOnlyRoots: "/etc"
      }),
    CODES.BIND_ENTRY_INVALID
  );
});
