

import path from "node:path";
import { fileURLToPath } from "node:url";

import integration from "../runner-integrations/go-test.mjs";
import { GO_OBSERVER_FILE, GO_REACH_FILE, goObserverSource, goReachSource, instrumentGoModule,
  instrumentGoTestFile } from "../source-instrumentation/go.mjs";
import { nativeProviderImplementation, refuseAttempt } from "./native-lifecycle.mjs";

const GO_INSTRUMENTATION_ASSET = fileURLToPath(new URL("../source-instrumentation/go.mjs", import.meta.url));

function layout(attempt) {
  if (attempt.module?.endsWith("_test.go")) {
    refuseAttempt("test_proof_native_selection_unsupported",
      "the declared Go module must be a package source, not a test file", { path: attempt.module });
  }
  const projectRoot = attempt.project === "." ? "" : attempt.project;
  const packageDir = path.posix.relative(projectRoot, path.posix.dirname(attempt.testFile));
  return { packagePath: packageDir === "" ? "." : `./${packageDir}` };
}

async function instrument(attempt) {
  const test = attempt.read(attempt.testFile);
  const wrapped = await instrumentGoTestFile({ source: test.source, selected: attempt.test[0] });
  const writes = [
    { path: attempt.testFileWork, content: wrapped.source },
    { path: path.join(path.dirname(attempt.testFileWork), GO_OBSERVER_FILE),
      content: goObserverSource({ packageName: wrapped.package_name, channel: attempt.channelPath,
        nonce: attempt.nonce, file: attempt.testFile }) }
  ];
  const result = { writes, declared_tests: wrapped.tests.map((name) => [name]) };
  if (attempt.module === null) return result;
  const { source, digest } = attempt.read(attempt.module);
  const probed = await instrumentGoModule({ source, modulePath: attempt.module,
    mutation: attempt.mutation });
  writes.push({ path: attempt.moduleWork, content: probed.source },
    { path: path.join(path.dirname(attempt.moduleWork), GO_REACH_FILE),
      content: goReachSource({ packageName: probed.package_name, channel: attempt.channelPath,
        nonce: attempt.nonce }) });
  return { ...result, module: { module_path: attempt.module, source_digest: digest,
    functions: probed.functions, probes: probed.probes, ...(probed.mutation ?? {}) } };
}

export default nativeProviderImplementation({
  family_id: "go-test",
  selector_kind: "go_test_name",
  runtime_runner: "go-test",
  identity_format: Object.freeze({ kind: "joined", separator: "::" }),
  completion: "selected_result",
  assets: [GO_INSTRUMENTATION_ASSET],
  layout,
  instrument,
  invocation: (attempt, { packagePath }) => integration.invocation({ runtime: attempt.runtime,
    projectDir: attempt.workProject, packagePath, testName: attempt.test[0] })
});
