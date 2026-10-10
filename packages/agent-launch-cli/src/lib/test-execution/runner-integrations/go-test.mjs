

import path from "node:path";

import { RunnerIntegrationPreconditionError, escapeRegExp } from "./common.mjs";

const TEST_FILES_TEMPLATE = "{{range .TestGoFiles}}{{println .}}{{end}}{{range .XTestGoFiles}}{{println .}}{{end}}";

function unsupported(message, detail) {
  throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unsupported", message, detail);
}

export default Object.freeze({
  runner_id: "runner.go-test",
  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.go,
    args: ["list", "-deps", "-test", "./..."], cwd: projectDir }),
  ordinaryInvocation: async ({ runtime, projectDir, file, selector, metadata, proof = null }) => {
    const directory = path.posix.dirname(file);
    const packagePath = directory === "." ? "." : `./${directory}`;
    if (!file.endsWith("_test.go")) {
      unsupported(`${file} is not a Go test file`, { reason: "go_target_not_test_file", file });
    }
    const overlay = proof === null ? [] : [`-overlay=${proof.overlay}`];
    const listed = await metadata({ command: runtime.executables.go,
      args: ["list", ...overlay, "-f", TEST_FILES_TEMPLATE, packagePath], cwd: projectDir });
    const testFiles = listed.stdout.split("\n").filter((line) => line !== "");
    if (!testFiles.includes(path.posix.basename(file))) {
      unsupported(`go list does not report ${file} as a test file of ${packagePath}`,
        { reason: "go_file_not_in_package_tests", package: packagePath, test_files: testFiles });
    }
    const selected = proof !== null ? ["-json", "-run", `^${escapeRegExp(proof.testName)}$`]
      : selector === null ? [] : [`-run=${selector}`];
    return {
      harness: Object.freeze({ kind: "go_test" }),
      selection: Object.freeze({ package: packagePath, test_files: Object.freeze(testFiles),
        scope: proof !== null ? "exact_test" : selector === null ? "package" : "package_tests_matching_selector" }),
      invocation: { command: runtime.executables.go, args: ["test", "-count=1", ...overlay, ...selected, packagePath],
        cwd: projectDir }
    };
  }
});
