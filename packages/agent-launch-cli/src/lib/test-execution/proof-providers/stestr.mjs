

import path from "node:path";
import { fileURLToPath } from "node:url";

import integration from "../runner-integrations/stestr.mjs";
import { escapeRegExp } from "../runner-integrations/common.mjs";
import { instrumentPythonModule } from "../source-instrumentation/python.mjs";
import { PYTHON_DIAGNOSTIC_GRAPH_ASSET } from "../../workspace-agent-test-proof-pytest-provider.mjs";
import { nativeProviderImplementation, refuseAttempt } from "./native-lifecycle.mjs";

const OBSERVER = fileURLToPath(new URL("../observers/stestr_observer.py", import.meta.url));
const PYTHON_INSTRUMENTATION_ASSET = fileURLToPath(
  new URL("../source-instrumentation/python.mjs", import.meta.url));

const SHELL_SAFE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function configuredValue(text, key) {
  const match = new RegExp(`^\\s*${key}\\s*[=:]\\s*(.+?)\\s*$`, "mu").exec(text);
  return match === null ? null : match[1];
}

function layout(attempt) {
  attempt.read(attempt.testFile);
  const configPath = path.posix.join(attempt.project, ".stestr.conf");
  const { source: config } = attempt.read(attempt.project === "." ? ".stestr.conf" : configPath);
  const topDir = path.posix.normalize(configuredValue(config, "top_dir") ?? "./");
  const projectRelative = path.posix.relative(attempt.project === "." ? "" : attempt.project,
    attempt.testFile);
  const moduleRelative = path.posix.relative(topDir === "." ? "" : topDir, projectRelative);
  const parts = moduleRelative.replace(/\.py$/u, "").split("/");
  if (moduleRelative.startsWith("..") || parts.some((part) => !IDENTIFIER_RE.test(part)) ||
      parts.at(-1) === "__init__") {
    refuseAttempt("test_proof_native_selection_unsupported",
      "the selected stestr module is not an importable module under the configured top_dir",
      { path: attempt.testFile, top_dir: topDir });
  }
  return { testId: [...parts, ...attempt.test].join(".") };
}

async function instrument(attempt, { testId }) {
  const selected_extra = { test_id: testId };
  if (attempt.module === null) return { selected_extra };
  const { source, digest } = attempt.read(attempt.module);
  const instrumented = await instrumentPythonModule({ source, modulePath: attempt.module,
    mutation: attempt.mutation });
  return {
    selected_extra,
    writes: [{ path: attempt.moduleWork, content: instrumented.source }],
    config: { instrumentation: { file: attempt.moduleWork, source_digest: digest } },
    module: { module_path: attempt.module, source_digest: digest, functions: instrumented.functions,
      probes: instrumented.probes, ...(instrumented.mutation ?? {}) }
  };
}

function invocation(attempt, { testId }) {
  const python = attempt.runtime.executables.python;
  const words = [python, OBSERVER, attempt.configPath];
  if (!words.every((word) => SHELL_SAFE_RE.test(word))) {
    refuseAttempt("test_proof_native_runner_unsupported",
      "the stestr worker command needs shell-inert interpreter and observer paths", {});
  }
  return integration.invocation({ runtime: attempt.runtime, projectDir: attempt.workProject,
    filter: `^${escapeRegExp(testId)}$`, workerPython: `${python} -B ${OBSERVER} ${attempt.configPath}` });
}

export default nativeProviderImplementation({
  family_id: "stestr",
  selector_kind: "stestr_test_id",
  runtime_runner: "stestr",
  identity_format: Object.freeze({ kind: "joined", separator: "." }),
  completion: "session_end",
  window_start: "explicit",
  assets: [OBSERVER, PYTHON_INSTRUMENTATION_ASSET, PYTHON_DIAGNOSTIC_GRAPH_ASSET],
  layout,
  instrument,
  invocation
});
