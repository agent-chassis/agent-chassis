

import { RunnerIntegrationPreconditionError, escapeRegExp } from "./common.mjs";

const SELECTOR_CHECK = "import json, re, sys\n" +
  "try:\n    re.compile(sys.argv[1])\n    re.compile(sys.argv[2])\n" +
  "except re.error as error:\n    print(json.dumps({\"valid\": False, \"error\": str(error)}))\n" +
  "else:\n    print(json.dumps({\"valid\": True}))\n";

const MODULE_FILE_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*\.py$/u;

function stestr(runtime, args) {
  return { command: runtime.executables.python, args: ["-I", "-B", "-m", "stestr", ...args] };
}

function invocation({ runtime, projectDir, filter, workerPython }) {
  return {
    ...stestr(runtime, ["--repo-url", `${runtime.scratchRoot}/stestr`, "run", "--concurrency", "1", filter]),
    cwd: projectDir,
    directories: [`${runtime.scratchRoot}/stestr`],
    env: { PYTHON: workerPython }
  };
}

export default Object.freeze({
  runner_id: "runner.stestr",
  setupProbe: ({ runtime, projectDir }) => ({ ...stestr(runtime, ["--version"]), cwd: projectDir }),
  invocation,

  ordinaryInvocation: async ({ runtime, projectDir, file, selector, metadata, proof = null }) => {
    if (proof !== null) {
      return { harness: Object.freeze({ kind: "stestr" }), selection: Object.freeze({ test_id_filter: proof.filter }),
        invocation: invocation({ runtime, projectDir, filter: proof.filter, workerPython: proof.workerPython }) };
    }
    if (!MODULE_FILE_RE.test(file)) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unsupported",
        `${file} is not a Python module path, so stestr's test-id filter cannot select it`,
        { reason: "stestr_file_not_module_path", file });
    }
    const module = file.slice(0, -".py".length).split("/").join(".");
    const filter = `^${escapeRegExp(module)}\\.${selector === null ? "" : `(?:${selector})`}`;
    if (selector !== null) {
      const checked = await metadata({ command: runtime.executables.python,
        args: ["-I", "-B", "-c", SELECTOR_CHECK, selector, filter], cwd: projectDir });
      let verdict;
      try {
        verdict = JSON.parse(checked.stdout);
      } catch (error) {
        throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unresolved",
          `the selector check did not print its verdict: ${error.message}`, { reason: "selector_check_unreadable" });
      }
      if (verdict?.valid !== true) {
        throw new RunnerIntegrationPreconditionError("ordinary_test_selector_invalid",
          `Python re rejects the stestr selector: ${verdict?.error ?? "no verdict"}`,
          { reason: "stestr_selector_not_python_regex", python_error: verdict?.error ?? null });
      }
    }
    return { harness: Object.freeze({ kind: "stestr" }), selection: Object.freeze({ test_id_filter: filter }),
      invocation: invocation({ runtime, projectDir, filter, workerPython: runtime.executables.python }) };
  }
});
