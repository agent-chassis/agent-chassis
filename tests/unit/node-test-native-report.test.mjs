

import assert from "node:assert/strict";
import test from "node:test";

import { createNativeReportObserver } from
  "../../packages/agent-launch-cli/src/lib/test-execution/confined-capture.mjs";
import { NODE_TEST_NATIVE_REPORT_BOUNDS, NODE_TEST_STARTUP_FAILURE_ORIGIN, nodeTestNativeReport } from
  "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/node-test-native-report.mjs";
import { isLauncherTestFailureDiagnostic } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";

const WORK_ROOT = "/work/checkout";
const TARGET = "tests/declared.test.mjs";
const TARGET_URL = `file://${WORK_ROOT}/${TARGET}`;
const VERSION = "Node.js v24.21.0";
const SPEC_TAIL = ["✖ /work/checkout/tests/declared.test.mjs (176.29ms)", "ℹ tests 1", "ℹ fail 1", "",
  "✖ failing tests:", "", "  'test failed'"];
const UNREADABLE = { path: "/native_report", reason: "native_report_unreadable" };

function read(lines, { workRoot = WORK_ROOT } = {}) {
  const adapter = nodeTestNativeReport({ workRoot });
  assert.equal(adapter.stream, "stdout");
  for (const line of lines) adapter.line(line);
  const { startup_failure: diagnostic, ...rest } = adapter.finish();
  assert.deepEqual(rest, {}, "the report carries one member");
  if (diagnostic !== null) {
    assert.equal(isLauncherTestFailureDiagnostic(diagnostic), true);
    assert.deepEqual(diagnostic.origin, NODE_TEST_STARTUP_FAILURE_ORIGIN);
    assert.deepEqual(diagnostic.values, []);
    assert.ok(diagnostic.errors.length <= 1, "no cause or aggregate graph is reconstructed");
    for (const error of diagnostic.errors) assert.equal(Object.hasOwn(error, "stack"), false);
  }
  return diagnostic;
}

const captured = (diagnostic) => {
  assert.equal(diagnostic.status, "captured");
  const [{ id, ...root }] = diagnostic.errors;
  assert.equal(id, diagnostic.root_error);
  return root;
};

const unavailable = (diagnostic, issues = [UNREADABLE]) => {
  assert.equal(diagnostic.status, "unavailable");
  assert.deepEqual(diagnostic.errors, []);
  assert.deepEqual(diagnostic.issues, issues);
};

const FRAMES = ["    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)",
  "    at async node:internal/modules/esm/loader:647:26"];

test("a missing ESM import keeps Node's code, message and printed url, with no invented location", () => {
  const message = `Cannot find module '${WORK_ROOT}/tests/absent.mjs' imported from ${WORK_ROOT}/${TARGET}`;
  const diagnostic = read(["node:internal/modules/esm/resolve:272", "    throw new ERR_MODULE_NOT_FOUND(",
    "          ^", "", `Error [ERR_MODULE_NOT_FOUND]: ${message}`,
    "    at finalizeResolution (node:internal/modules/esm/resolve:272:11)",
    "    at ModuleJob.link (node:internal/modules/esm/module_job:381:17) {",
    "  code: 'ERR_MODULE_NOT_FOUND',", `  url: 'file://${WORK_ROOT}/tests/absent.mjs'`, "}", "", VERSION,
    ...SPEC_TAIL]);
  assert.deepEqual(captured(diagnostic), { name: "Error", message, code: "ERR_MODULE_NOT_FOUND",
    native_details: [{ label: "url", text: `'file://${WORK_ROOT}/tests/absent.mjs'` }] });
  assert.deepEqual(diagnostic.issues, []);
});

test("a missing CommonJS module keeps its multiline message and its checkout frame", () => {
  const diagnostic = read(["node:internal/modules/cjs/loader:1568", "  throw err;", "  ^", "",
    "Error: Cannot find module './absent.cjs'", "Require stack:", `- ${WORK_ROOT}/tests/declared.test.cjs`,
    "    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)",
    `    at Object.<anonymous> (${WORK_ROOT}/tests/declared.test.cjs:2:1)`,
    "    at Module._compile (node:internal/modules/cjs/loader:1929:14) {",
    "  code: 'MODULE_NOT_FOUND',", "  requireStack: [", `    '${WORK_ROOT}/tests/declared.test.cjs'`, "  ]",
    "}", "", VERSION]);

  assert.deepEqual(captured(diagnostic), { name: "Error",
    message: `Cannot find module './absent.cjs'\nRequire stack:\n- ${WORK_ROOT}/tests/declared.test.cjs`,
    code: "MODULE_NOT_FOUND", location: { file: "tests/declared.test.cjs", line: 2, column: 1 } });
  assert.deepEqual(diagnostic.issues, []);
});

test("a syntax error keeps its name, message and source line, and no code or column", () => {
  const diagnostic = read([`${TARGET_URL}:2`, "const broken = ;", "               ^", "",
    "SyntaxError: Unexpected token ';'",
    "    at compileSourceTextModule (node:internal/modules/esm/utils:319:16)",
    "    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:89:18)", "", VERSION,
    ...SPEC_TAIL]);
  assert.deepEqual(captured(diagnostic), { name: "SyntaxError", message: "Unexpected token ';'",
    location: { file: TARGET, line: 2 } });
  assert.deepEqual(diagnostic.issues, []);
});

test("a custom-code exception before registration keeps its code, column and filesystem properties", () => {
  const diagnostic = read(["output the file printed first", `${TARGET_URL}:4`,
    "throw Object.assign(new Error(\"manifest unavailable\\nsecond line\"), {", "                    ^", "",
    "Error: manifest unavailable", "second line", `    at ${TARGET_URL}:4:21`, `${FRAMES[0]}`,
    `${FRAMES[1]} {`, "  errno: -2,", "  code: 'ERR_FIXTURE_MANIFEST',", "  syscall: 'open',",
    "  path: '/nonexistent/manifest.json'", "}", "", VERSION, ...SPEC_TAIL]);
  assert.deepEqual(captured(diagnostic), { name: "Error", message: "manifest unavailable\nsecond line",
    code: "ERR_FIXTURE_MANIFEST", location: { file: TARGET, line: 4, column: 21 },
    native_details: [{ label: "errno", text: "-2" }, { label: "syscall", text: "'open'" },
      { label: "path", text: "'/nonexistent/manifest.json'" }] });
  assert.deepEqual(diagnostic.issues, []);
});

test("a printed cause or aggregate member is named as unread and never rebuilt", () => {
  const withCause = read([`${TARGET_URL}:2`, "throw new Error(\"outer\", { cause });", "      ^", "",
    "Error: outer", `    at ${TARGET_URL}:2:7`, `${FRAMES[0]} {`, "  [cause]: Error: inner",
    `      at ${TARGET_URL}:2:49 {`, "    code: 'E_INNER'", "  }", "}", "", VERSION]);
  assert.deepEqual(captured(withCause), { name: "Error", message: "outer",
    location: { file: TARGET, line: 2, column: 7 } });
  assert.deepEqual(withCause.issues, [{ path: "/native_report/cause", reason: "native_report_unreadable" }]);
  assert.equal(JSON.stringify(withCause).includes("E_INNER"), false, "a nested code is not the error's code");

  const aggregate = read([`${TARGET_URL}:2`, "Promise.reject(new AggregateError([new Error(\"a\")], \"agg\"));",
    "               ^", "", "AggregateError: agg", `    at ${TARGET_URL}:2:16 {`, "  [errors]: [",
    "    Error: a", `        at ${TARGET_URL}:2:36`, "  ]", "}", "", VERSION]);
  assert.deepEqual(captured(aggregate), { name: "AggregateError", message: "agg",
    location: { file: TARGET, line: 2, column: 16 } });
  assert.deepEqual(aggregate.issues,
    [{ path: "/native_report/aggregate_errors", reason: "native_report_unreadable" }]);
});

test("a bracketed name that is not a code, and a location outside the checkout, are not reported as facts", () => {
  const diagnostic = read(["/elsewhere/dependency/index.mjs:9", "controller.abort();", "           ^", "",
    "DOMException [AbortError]: This operation was aborted", "    at /elsewhere/dependency/index.mjs:9:12", "",
    VERSION]);
  assert.deepEqual(captured(diagnostic), { name: "DOMException", message: "This operation was aborted" });
});

test("terminal styling and carriage returns do not change what is read", () => {
  const diagnostic = read([`${TARGET_URL}:2\r`, "throw new Error(\"styled\");\r", "      ^\r", "\r",
    "\u001b[31mError: styled\u001b[39m\r", `    at ${TARGET_URL}:2:7\r`, "\r", `${VERSION}\r`]);
  assert.deepEqual(captured(diagnostic), { name: "Error", message: "styled",
    location: { file: TARGET, line: 2, column: 7 } });
});

test("output with no exception report is no report", () => {
  assert.equal(read([]), null);
  assert.equal(read(["▶ suite", "  ✔ selected (1.2ms)", "Error: a test printed this", "ℹ pass 1"]), null);
});

test("ESM loader errors retain their native cause with optional blank header padding", () => {
  for (const padding of [[], [""], ["", ""]]) {
    const diagnostic = read(["node:internal/modules/run_main:107", "    triggerUncaughtException(",
      "    ^", ...padding, "Error: forced-invocation runner export is absent",
      "    at validateTestProofModuleFaultExportPopulation (file:///launcher/contract.mjs:127:33)",
      "    at initialize (file:///launcher/loader.mjs:43:22)", "", VERSION]);
    assert.deepEqual(captured(diagnostic), { name: "Error",
      message: "forced-invocation runner export is absent" });
    assert.deepEqual(diagnostic.issues, []);
  }

  unavailable(read(["node:internal/modules/run_main:107", "    triggerUncaughtException(",
    "    ^", "", "", "{ reason: 'object' }", "", VERSION]));
  unavailable(read(["node:internal/modules/run_main:107", "    triggerUncaughtException(",
    "    ^", "", "", "Error: unterminated"]));
});

test("a thrown non-error, an unrecognized report and a bare terminator are explicit limitations", () => {

  unavailable(read(["node:internal/modules/run_main:107", "    triggerUncaughtException(", "    ^", "abc",
    "(Use `node --trace-uncaught ...` to show where the exception was thrown)", "", VERSION]));
  unavailable(read([`${TARGET_URL}:2`, "throw { reason: \"object\" };", "^", "", "{ reason: 'object' }", "",
    VERSION]));
  unavailable(read([VERSION]));
  unavailable(read([`${TARGET_URL}:2`, "source", "^", "", "bareword", "", VERSION]));
});

test("a report cut off before its terminator is unreadable, with no partial fields", () => {
  const diagnostic = read([`${TARGET_URL}:4`, "throw new Error(\"cut off\");", "      ^", "", "Error: cut off",
    `    at ${TARGET_URL}:4:7`]);
  unavailable(diagnostic);
  assert.equal(JSON.stringify(diagnostic).includes("cut off"), false);
});

test("a property block that never closes keeps the error and says the report was not fully read", () => {
  const diagnostic = read([`${TARGET_URL}:4`, "throw error;", "^", "", "Error: half printed",
    `    at ${TARGET_URL}:4:1 {`, "  code: 'ERR_NEVER_CLOSED',", "", VERSION]);
  assert.deepEqual(captured(diagnostic), { name: "Error", message: "half printed",
    location: { file: TARGET, line: 4, column: 1 } });
  assert.deepEqual(diagnostic.issues, [UNREADABLE]);
});

test("an overlong message, report and property set each stay bounded and say so", () => {
  const { lines, message_bytes: messageBytes, details, detail_bytes: detailBytes } = NODE_TEST_NATIVE_REPORT_BOUNDS;
  const head = [`${TARGET_URL}:4`, "throw error;", "^", ""];

  const longMessage = read([...head, "Error: first line", ...Array.from({ length: 200 }, () => "m".repeat(100)),
    `    at ${TARGET_URL}:4:1`, "", VERSION]);
  const kept = captured(longMessage);
  assert.ok(kept.message.startsWith("first line\n"));
  assert.ok(Buffer.byteLength(kept.message, "utf8") <= messageBytes);
  assert.deepEqual(longMessage.issues, [{ path: "/native_report/message", reason: "capture_budget_exceeded" }]);

  const longReport = read([...head, "Error: many lines",
    ...Array.from({ length: lines + 50 }, (_, index) => `continued ${index}`), VERSION]);
  assert.equal(captured(longReport).name, "Error");
  assert.ok(longReport.issues.some(({ path, reason }) => path === "/native_report" &&
    reason === "capture_budget_exceeded"));

  const manyProperties = read([...head, "Error: many properties", `    at ${TARGET_URL}:4:1 {`,
    ...Array.from({ length: details + 4 }, (_, index) => `  property${index}: ${index},`),
    `  oversized: '${"v".repeat(detailBytes + 1)}'`, "}", "", VERSION]);
  assert.equal(captured(manyProperties).native_details.length, details);
  assert.deepEqual(manyProperties.issues, [{ path: "/native_report/details", reason: "capture_budget_exceeded" }]);
});

test("the last terminated report is the process's own; an earlier printed one never replaces it", () => {
  const diagnostic = read(["file:///printed/lookalike.mjs:1", "throw new Error('printed');", "^", "",
    "Error: printed lookalike", "    at file:///printed/lookalike.mjs:1:7 {", "  code: 'ERR_PRINTED_LOOKALIKE'", "}",
    "", "Node.js v0.0.0", `${TARGET_URL}:9`, "throw error;", "^", "", "Error [ERR_REAL]: real failure",
    `    at ${TARGET_URL}:9:1`, "", VERSION, ...SPEC_TAIL]);
  assert.deepEqual(captured(diagnostic), { name: "Error", message: "real failure", code: "ERR_REAL",
    location: { file: TARGET, line: 9, column: 1 } });
});

test("the shared report observer frames the stream and marks a dropped overlong line", () => {
  const text = [`${TARGET_URL}:4`, "throw error;", "^", "", "Error: framed",
    `    at ${TARGET_URL}:4:1 {`, "  code: 'ERR_FRAMED'", "}", "", VERSION, ...SPEC_TAIL].join("\n");

  const whole = createNativeReportObserver(nodeTestNativeReport({ workRoot: WORK_ROOT }));
  for (let offset = 0; offset < text.length; offset += 7) whole.push(Buffer.from(text.slice(offset, offset + 7)));
  const framed = whole.finish();
  assert.equal(framed.unreadable, false);
  assert.deepEqual(captured(framed.startup_failure), { name: "Error", message: "framed", code: "ERR_FRAMED",
    location: { file: TARGET, line: 4, column: 1 } });

  const lossy = createNativeReportObserver(nodeTestNativeReport({ workRoot: WORK_ROOT }), { lineCapBytes: 256 });
  lossy.push(Buffer.from(`${"x".repeat(1024)}\n${text}\n`));
  const marked = lossy.finish();
  assert.equal(marked.unreadable, true);
  assert.equal(captured(marked.startup_failure).code, "ERR_FRAMED");

  const lost = createNativeReportObserver(nodeTestNativeReport({ workRoot: WORK_ROOT }), { lineCapBytes: 256 });
  lost.push(Buffer.from(text.replace("Error: framed", `Error: ${"y".repeat(1024)}`)));
  const result = lost.finish();
  assert.equal(result.unreadable, true);
  assert.equal(result.startup_failure.status, "unavailable");
});
