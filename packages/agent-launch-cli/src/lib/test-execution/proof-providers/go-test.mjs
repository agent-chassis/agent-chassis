

import path from "node:path";
import { fileURLToPath } from "node:url";

import integration from "../runner-integrations/go-test.mjs";
import { GO_OBSERVER_FILE, GO_REACH_FILE, goObserverSource, goReachSource, instrumentGoModule,
  instrumentGoTestFile } from "../source-instrumentation/go.mjs";
import { nativeRecordFailureDiagnostic } from "../../workspace-agent-test-proof-error-diagnostic.mjs";
import { nativeProviderImplementation, refuseAttempt } from "./native-lifecycle.mjs";

const GO_INSTRUMENTATION_ASSET = fileURLToPath(new URL("../source-instrumentation/go.mjs", import.meta.url));

const MAX_ERROR_RECORDS = 16;
const MAX_RECORD_BYTES = 64 * 1024;

const RECORD_PREFIX_RE = /^\s*([^\s:][^:\n]*\.go):([1-9][0-9]*): ?/u;
const CONTINUATION_INDENT = "        ";

export function goTestReport(testName) {
  const records = [];
  const issues = [];
  let typed = false;
  let current = null;
  const inSelected = (test) => typeof test === "string" &&
    (test === testName || test.startsWith(`${testName}/`));
  const append = (record, text) => {
    if (Buffer.byteLength(record.message, "utf8") + Buffer.byteLength(text, "utf8") > MAX_RECORD_BYTES) {
      if (!record.truncated) issues.push({ path: `/native_report/${record.index}`, reason: "capture_budget_exceeded" });
      record.truncated = true;
      return;
    }
    record.message += text;
  };
  return {
    stream: "stdout",
    line(text) {
      let event;
      try { event = JSON.parse(text); } catch { return; }
      if (event === null || typeof event !== "object" || event.Action !== "output" ||
          !inSelected(event.Test) || typeof event.Output !== "string") return;
      if (Object.hasOwn(event, "OutputType")) typed = true;
      if (event.OutputType === "error") {
        current = null;
        if (records.length === MAX_ERROR_RECORDS) {
          if (!issues.some(({ path }) => path === "/native_report")) {
            issues.push({ path: "/native_report", reason: "capture_budget_exceeded" });
          }
          return;
        }
        const body = event.Output.replace(/\n$/u, "");
        const prefix = RECORD_PREFIX_RE.exec(body);
        current = { index: records.length, test: event.Test, truncated: false,
          ...(prefix === null ? {} : { location: { file: prefix[1], line: Number(prefix[2]) } }),
          message: "" };
        append(current, prefix === null ? body.trimStart() : body.slice(prefix[0].length));
        records.push(current);
      } else if (event.OutputType === "error-continue" && current !== null && current.test === event.Test) {
        const body = event.Output.replace(/\n$/u, "");
        append(current, `\n${body.startsWith(CONTINUATION_INDENT) ? body.slice(CONTINUATION_INDENT.length) : body}`);
      } else current = null;
    },
    finish() {

      if (records.length === 0) {
        return { selected_failure: typed ? null : nativeRecordFailureDiagnostic({
          issues: [{ path: "/native_report", reason: "native_attribution_unavailable" }] }) };
      }
      const subtests = [...new Set(records.map(({ test }) => test))];
      return {
        selected_failure: nativeRecordFailureDiagnostic({ root: { name: "testing.T failure" },
          records: records.map(({ message, location }) => ({ message, ...(location ? { location } : {}) })),
          origin: subtests.length === 1 && subtests[0] !== testName
            ? { kind: "subtest", name: subtests[0] } : undefined,
          issues })
      };
    }
  };
}

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
    projectDir: attempt.workProject, packagePath, testName: attempt.test[0] }),
  report: (attempt) => goTestReport(attempt.test[0])
});
