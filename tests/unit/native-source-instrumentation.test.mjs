

import assert from "node:assert/strict";
import test from "node:test";

import { goObserverSource, instrumentGoModule, instrumentGoTestFile } from
  "../../packages/agent-launch-cli/src/lib/test-execution/source-instrumentation/go.mjs";
import { SourceInstrumentationError, applyEdits } from
  "../../packages/agent-launch-cli/src/lib/test-execution/source-instrumentation/index.mjs";
import { instrumentJavaScriptModule } from
  "../../packages/agent-launch-cli/src/lib/test-execution/source-instrumentation/javascript.mjs";
import { PYTHON_DIRECTIVE_MARKER, instrumentPythonModule } from
  "../../packages/agent-launch-cli/src/lib/test-execution/source-instrumentation/python.mjs";
import { finishRustFile, instrumentRustModule, instrumentRustTestFile } from
  "../../packages/agent-launch-cli/src/lib/test-execution/source-instrumentation/rust.mjs";

const refusedWith = (reason) => (error) => error instanceof SourceInstrumentationError &&
  error.code === "test_proof_native_instrumentation_unsupported" && error.reason === reason;
const lines = (text) => text.split("\n").length;
const TOKEN = /^[0-9a-f]{32}$/u;

function assertProbes(probes, expected, source, render) {
  assert.deepEqual(probes.map(({ function_name: name, line, mutated }) => [name, line, mutated]), expected);
  assert.equal(new Set(probes.map(({ token }) => token)).size, probes.length);
  for (const { token } of probes) {
    assert.match(token, TOKEN);
    assert.ok(source.includes(render(token)), token);
  }
  assert.doesNotMatch(source, /\btrue\)|\bfalse\)/u, "the source never states which function is mutated");
}

test("JavaScript and TypeScript modules gain line-preserving probes and one exact substitution", async () => {
  const source = [
    "\"use strict\";",
    "export function answer() {",
    "  return 42;",
    "}",
    "export const helper = (value) => { \"use strict\"; return value * 2; };",
    "function other() { return 'x'; }",
    ""
  ].join("\n");
  const traced = await instrumentJavaScriptModule({ source, modulePath: "src/answer.mjs" });
  assert.equal(lines(traced.source), lines(source));
  assert.deepEqual(traced.functions.map(({ name }) => name), ["answer", "helper", "other"]);
  assert.equal(traced.mutation, null);
  assert.match(traced.source, /"use strict"; Reflect\.get\(globalThis/u, "probes follow directive prologues");
  const mutated = await instrumentJavaScriptModule({ source, modulePath: "src/answer.mjs",
    mutation: { function_name: "answer", replacement: 41 } });
  assert.match(mutated.source, /return 41;/u);
  const jsProbe = (token) => `Symbol.for("launcher.test-proof.reach"))?.("${token}");`;
  assertProbes(mutated.probes, [["answer", 2, true], ["helper", 5, false], ["other", 6, false]],
    mutated.source, jsProbe);
  assert.notDeepEqual(mutated.probes.map(({ token }) => token), traced.probes.map(({ token }) => token),
    "every attempt mints fresh credentials");
  assert.deepEqual({ original: mutated.mutation.original, kind: mutated.mutation.original_kind },
    { original: 42, kind: "integer" });

  const typed = await instrumentJavaScriptModule({ modulePath: "src/answer.ts",
    source: "export function answer(): number {\n  return 42;\n}\n",
    mutation: { function_name: "answer", replacement: 7 } });
  assert.match(typed.source, /return 7;/u);

  for (const [reason, text, mutation] of [
    ["replacement_not_distinct", source, { function_name: "answer", replacement: 42 }],
    ["replacement_kind_incompatible", source, { function_name: "answer", replacement: "42" }],
    ["replacement_not_scalar", source, { function_name: "answer", replacement: [1] }],
    ["function_absent", source, { function_name: "missing", replacement: 1 }],
    ["body_not_single_scalar_return", "export function answer() { const x = 1; return x; }\n",
      { function_name: "answer", replacement: 1 }],
    ["function_not_synchronous", "export async function answer() { return 1; }\n",
      { function_name: "answer", replacement: 2 }],
    ["return_literal_unsupported", "export function answer() { return compute(); }\n",
      { function_name: "answer", replacement: 2 }],
    ["function_not_unique", "function answer() { return 1; }\nfunction answer() { return 1; }\n",
      { function_name: "answer", replacement: 2 }],
    ["source_unparsable", "export function answer( { return 1; }\n", null]
  ]) {
    await assert.rejects(instrumentJavaScriptModule({ source: text, modulePath: "src/answer.mjs", mutation }),
      refusedWith(reason), reason);
  }
  await assert.rejects(instrumentJavaScriptModule({ source, modulePath: "src/answer.coffee" }),
    refusedWith("source_language_unsupported"));
});

test("Go modules and test files are instrumented without changing lines", async () => {
  const source = "package calc\n\n// Answer is 42.\nfunc Answer() int {\n\treturn 42\n}\n\nfunc (c Calc) Name() string {\n\treturn \"calc\"\n}\n";
  const module = await instrumentGoModule({ source, modulePath: "go/calc/answer.go",
    mutation: { function_name: "Answer", replacement: 41 } });
  assert.equal(lines(module.source), lines(source));
  assert.equal(module.package_name, "calc");
  assert.match(module.source, /return 41/u);
  assertProbes(module.probes, [["Answer", 4, true], ["Name", 8, false]], module.source,
    (token) => `zzLauncherTestProofReach("${token}");`);
  await assert.rejects(instrumentGoModule({ source, modulePath: "go/calc/answer.go",
    mutation: { function_name: "Answer", replacement: "x" } }), refusedWith("replacement_kind_incompatible"));

  const tests = "package calc_test\n\nimport (\n\tt2 \"testing\"\n)\n\nfunc TestAnswer(t *t2.T) {\n}\n\nfunc TestGeneric[T any](t *t2.T) {\n}\n\nfunc helper(t *t2.T) {\n}\n";
  const wrapped = await instrumentGoTestFile({ source: tests, selected: "TestAnswer" });
  assert.deepEqual(wrapped.tests, ["TestAnswer"]);
  assert.match(wrapped.source, /defer zzLauncherTestProofEnter\(t, "TestAnswer"\)\(\)/u);
  assert.equal(lines(wrapped.source), lines(tests));

  const unsupportedShape = `${tests}\nfunc TestUnnamed(_ *t2.T) {\n}\n`;
  for (const [selected, reason] of [["TestGeneric", "selected_test_shape_unsupported"],
    ["TestUnnamed", "selected_test_shape_unsupported"], ["TestAbsent", "selected_test_not_observable"],
    ["helper", "selected_test_not_observable"]]) {
    await assert.rejects(instrumentGoTestFile({ source: unsupportedShape, selected }), (error) =>
      refusedWith(reason)(error) && error.detail.test === selected, selected);
  }

  const composed = "package calc_test\n\nimport \"testing\"\n\nfunc TestAnswer(t *testing.T) {\n" +
    "\tTestPreserves(t)\n\tt.Run(\"preserves\", TestPreserves)\n}\n\nfunc TestPreserves(t *testing.T) {\n}\n";
  const selectedOnly = await instrumentGoTestFile({ source: composed, selected: "TestAnswer" });
  assert.deepEqual(selectedOnly.tests, ["TestAnswer", "TestPreserves"]);
  assert.equal(selectedOnly.source.match(/zzLauncherTestProofEnter/gu).length, 1);
  assert.match(selectedOnly.source, /func TestPreserves\(t \*testing\.T\) \{\n\}/u);
  assert.equal(lines(selectedOnly.source), lines(composed));
  const other = await instrumentGoTestFile({ source: composed, selected: "TestPreserves" });
  assert.match(other.source, /func TestAnswer\(t \*testing\.T\) \{\n\tTestPreserves/u);

  const observer = goObserverSource({ packageName: "calc_test", channel: "/c", nonce: "n", file: "f" });
  assert.match(observer, /root := zzLauncherTestProofRoot\.t == nil && t\.Name\(\) == name/u);
  assert.match(observer, /if !root \{\n\t\treturn func\(\) \{\}\n\t\}/u);
  const cleanup = observer.slice(observer.indexOf("t.Cleanup(func() {"));
  assert.ok(cleanup.indexOf("\"window_end\"") < cleanup.indexOf("\"test_result\""));
  const deferred = observer.slice(observer.lastIndexOf("return func() {"));
  assert.doesNotMatch(deferred, /window_end|test_result/u, "function return closes nothing");
  assert.match(deferred, /panic\(recovered\)/u, "a recorded panic is re-raised");

  assert.match(cleanup, /"errors": \[\]any\{map\[string\]any\{"id": "error-0", "name": "panic", "message": panicMessage\}\}/u);
  assert.match(cleanup, /"status": "unavailable"[^\n]*\n[^\n]*"issues": \[\]any\{map\[string\]any\{"path": "\/error", "reason": "error_not_supplied"\}\}/u);
  assert.match(cleanup, /"assertion_failure": failed && !panicked/u, "assertion attribution is unchanged");
  assert.doesNotMatch(observer, /"error":/u, "the removed lossy error record is gone");
});

test("Rust crates receive guards, probes and the observer module", async () => {
  const lib = "/// Answer.\npub fn answer() -> u32 {\n    42\n}\n\npub fn negative() -> i32 {\n    return -3;\n}\n";
  const module = await instrumentRustModule({ source: lib, modulePath: "rust/src/lib.rs",
    mutation: { function_name: "answer", replacement: 41 } });
  const finished = finishRustFile({ source: lib, edits: module.edits, crateRoot: true,
    channel: "/agent-validation-tmp/channel", nonce: "n".repeat(64), sourceId: "lib" });
  assert.match(finished, /\n    41\n/u);
  assertProbes(module.probes, [["answer", 2, true], ["negative", 6, false]], applyEdits(lib, module.edits),
    (token) => `crate::__launcher_test_proof::reach("${token}");`);
  assert.ok(finished.startsWith(applyEdits(lib, module.edits)));
  assert.match(finished, /pub fn reach\(token: &str\)/u);
  assert.match(finished, /pub mod __launcher_test_proof/u);
  assert.equal(lines(applyEdits(lib, module.edits)), lines(lib));
  await assert.rejects(instrumentRustModule({ source: lib, modulePath: "rust/src/lib.rs",
    mutation: { function_name: "negative", replacement: 1.5 } }), refusedWith("replacement_kind_incompatible"));

  const tests = "#[test]\nfn plain() {}\n\n#[test]\nfn returns() -> Result<(), String> { Ok(()) }\n\nmod nested {\n    #[test]\n    fn inner() {}\n}\n";
  const guarded = await instrumentRustTestFile({ source: tests, selected: ["nested", "inner"],
    file: "rust/tests/answer.rs" });
  assert.deepEqual(guarded.tests, [["plain"], ["nested", "inner"]]);

  assert.equal(guarded.edits.length, 1);
  const edited = applyEdits(tests, guarded.edits);
  assert.match(edited, /fn inner\(\) \{ let _launcher_test_proof_guard = crate::__launcher_test_proof::enter\("rust\/tests\/answer\.rs", "nested::inner"\);\}/u);
  assert.match(edited, /fn plain\(\) \{\}/u);
  assert.equal(lines(edited), lines(tests));

  assert.match(finished, /if ENTERED\.swap\(true, std::sync::atomic::Ordering::SeqCst\) \{\n\s+return Guard \{ file, path, active: false \};/u);
  assert.match(finished, /fn drop\(&mut self\) \{\n\s+if !self\.active \{\n\s+return;/u);

  assert.match(finished, /let location = info\.location\(\)\.map\(\|at\| \(at\.file\(\)\.to_string\(\), at\.line\(\)\)\);/u);
  assert.match(finished, /let assertion = message\.as_deref\(\)\.is_some_and\(\|text\| text\.starts_with\("assertion"\)\);/u);

  assert.match(finished, /\\"location\\":\{\{\\"file\\":\{\},\\"line\\":\{\}\}\}/u);
  assert.doesNotMatch(finished, /at\.column\(\)/u);
  assert.match(finished, /if panic\.message\.is_none\(\) \{\n\s+"\{\\"path\\":\\"\/error\/message\\",\\"reason\\":\\"unsupported_value_type\\"\}"/u);
  assert.match(finished, /let failed = std::thread::panicking\(\);/u);
  assert.match(finished, /failed && assertion, diagnostic\)\);/u);
  assert.doesNotMatch(finished, /\\"error\\":/u, "the removed lossy error record is gone");
  await assert.rejects(instrumentRustTestFile({ source: tests, selected: ["returns"], file: "t.rs" }),
    refusedWith("selected_test_shape_unsupported"));
  await assert.rejects(instrumentRustTestFile({ source: tests, selected: ["absent"], file: "t.rs" }),
    refusedWith("selected_test_not_observable"));
});

test("Python modules carry their credentials only in the appended directive line", async () => {
  const source = "def answer():\n    \"\"\"Docstring.\"\"\"\n    return 42\n\n\nclass Calc:\n    def name(self):\n        return 'calc'";
  const instrumented = await instrumentPythonModule({ source, modulePath: "app/answer.py",
    mutation: { function_name: "answer", replacement: 41 } });
  assert.deepEqual(instrumented.mutation.original, 42);
  assert.deepEqual(instrumented.probes.map(({ function_name: name, line, mutated }) => [name, line, mutated]),
    [["answer", 1, true], ["name", 7, false]]);

  assert.ok(instrumented.source.startsWith(`${source}\n${PYTHON_DIRECTIVE_MARKER}`));
  const directive = JSON.parse(instrumented.source.split("\n").at(-2).slice(PYTHON_DIRECTIVE_MARKER.length));
  assert.equal(directive.original_bytes, Buffer.byteLength(source));
  assert.deepEqual(directive.probes, Object.fromEntries(instrumented.probes.map((probe) =>
    [`${probe.line}:${probe.function_name}`, probe.token])));
  assert.deepEqual(directive.mutation, { function_name: "answer", line: 1, replacement: 41 });
  const traced = await instrumentPythonModule({ source: `${source}\n`, modulePath: "app/answer.py" });
  assert.equal(traced.source.split("\n").length, source.split("\n").length + 2);
  assert.equal(JSON.parse(traced.source.split("\n").at(-2).slice(PYTHON_DIRECTIVE_MARKER.length)).mutation, null);
  await assert.rejects(instrumentPythonModule({ source, modulePath: "a.py",
    mutation: { function_name: "answer", replacement: 42 } }), refusedWith("replacement_not_distinct"));
  await assert.rejects(instrumentPythonModule({ source: "async def answer():\n    return 1\n", modulePath: "a.py",
    mutation: { function_name: "answer", replacement: 2 } }), refusedWith("function_not_synchronous"));
});

test("edits never change line structure or overlap", () => {
  assert.throws(() => applyEdits("a\nb", [{ index: 0, insert: "x\ny" }]), refusedWith("edit_changes_lines"));
  assert.throws(() => applyEdits("a\nb", [{ index: 0, remove: 3, insert: "z" }]),
    refusedWith("edit_changes_lines"));
  assert.throws(() => applyEdits("abcdef", [{ index: 1, remove: 3, insert: "z" }, { index: 2, insert: "y" }]),
    refusedWith("overlapping_edits"));
  assert.equal(applyEdits("abc", [{ index: 1, insert: "X" }, { index: 3, insert: "Y" }]), "aXbcY");
});
