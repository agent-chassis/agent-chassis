

import { applyEdits, assertDistinctReplacement, namedChildren, parseSource, probeFacts, probeToken,
  unsupported } from "./index.mjs";

export const GO_OBSERVER_FILE = "zz_launcher_test_proof_observer_test.go";
export const GO_REACH_FILE = "zz_launcher_test_proof_reach.go";
const TEST_FUNCTION_RE = /^Test(?:[A-Z0-9_][A-Za-z0-9_]*)?$/u;

const goString = (value) => JSON.stringify(value);

function packageName(tree) {
  const clause = namedChildren(tree.rootNode).find(({ type }) => type === "package_clause");
  const name = clause === undefined ? null : namedChildren(clause)[0]?.text ?? null;
  if (name === null) unsupported("package_clause_absent");
  return name;
}

function bodyProbeIndex(body) {
  return body.startIndex + 1;
}

function literalValue(node) {
  switch (node.type) {
    case "int_literal": {
      const text = node.text.replaceAll("_", "");
      if (/^0[0-9]/u.test(text)) unsupported("return_literal_unsupported");
      const value = Number(text);
      if (!Number.isSafeInteger(value)) unsupported("return_literal_unsupported");
      return { value, kind: "integer" };
    }
    case "float_literal": {
      const value = Number(node.text.replaceAll("_", ""));
      if (!Number.isFinite(value)) unsupported("return_literal_unsupported");
      return { value, kind: "float" };
    }
    case "interpreted_string_literal":
      if (node.text.includes("\\")) unsupported("return_literal_unsupported");
      return { value: node.text.slice(1, -1), kind: "string" };
    case "raw_string_literal":
      return { value: node.text.slice(1, -1), kind: "string" };
    case "true": return { value: true, kind: "boolean" };
    case "false": return { value: false, kind: "boolean" };
    case "unary_expression": {
      const [operand] = namedChildren(node);
      if (node.childForFieldName("operator")?.text !== "-" ||
          !["int_literal", "float_literal"].includes(operand?.type)) {
        unsupported("return_literal_unsupported");
      }
      const inner = literalValue(operand);
      return { value: -inner.value, kind: inner.kind };
    }
    default:
      return unsupported("return_literal_unsupported");
  }
}

const compatible = (original, replacement) => original === replacement ||
  (original === "float" && replacement === "integer");

function goLiteral(value, originalKind) {
  if (typeof value === "string") return goString(value);
  if (typeof value === "number" && originalKind === "float" && Number.isInteger(value)) {
    return `${value}.0`;
  }
  return String(value);
}

function mutationTarget(tree, functionName) {
  const declarations = namedChildren(tree.rootNode).filter((node) =>
    node.type === "function_declaration" && node.childForFieldName("name")?.text === functionName);
  if (declarations.length === 0) unsupported("function_absent");
  if (declarations.length > 1) unsupported("function_not_unique");
  const [declaration] = declarations;
  if (declaration.childForFieldName("type_parameters") !== null) unsupported("function_generic");
  const block = declaration.childForFieldName("body");
  const statements = block === null ? [] : namedChildren(block)
    .flatMap((node) => node.type === "statement_list" ? namedChildren(node) : [node]);
  if (statements.length !== 1 || statements[0].type !== "return_statement") {
    unsupported("body_not_single_scalar_return");
  }
  const [list] = namedChildren(statements[0]);
  const values = list?.type === "expression_list" ? namedChildren(list) : [];
  if (values.length !== 1) unsupported("body_not_single_scalar_return");
  return { declaration, literal: values[0] };
}

export async function instrumentGoModule({ source, modulePath, mutation = null }) {
  const tree = await parseSource("go", source);
  const edits = [];
  let mutated = null;
  let mutatedId = null;
  if (mutation !== null) {
    const target = mutationTarget(tree, mutation.function_name);
    const original = literalValue(target.literal);
    const replacementKind = assertDistinctReplacement({ originalKind: original.kind,
      originalValue: original.value, replacement: mutation.replacement, compatible });
    edits.push({ index: target.literal.startIndex,
      remove: target.literal.endIndex - target.literal.startIndex,
      insert: goLiteral(mutation.replacement, original.kind) });
    mutatedId = target.declaration.id;
    mutated = { function_name: mutation.function_name, line: target.declaration.startPosition.row + 1,
      original: original.value, original_kind: original.kind, replacement: mutation.replacement,
      replacement_kind: replacementKind };
  }
  const functions = [];
  const probes = [];
  for (const node of namedChildren(tree.rootNode)) {
    if (!["function_declaration", "method_declaration"].includes(node.type)) continue;
    const body = node.childForFieldName("body");
    if (body === null) continue;
    const name = node.childForFieldName("name").text;
    const line = node.startPosition.row + 1;
    const token = probeToken();
    functions.push({ name, line });
    probes.push(probeFacts(token, name, line, node.id === mutatedId));
    edits.push({ index: bodyProbeIndex(body), insert: ` zzLauncherTestProofReach(${goString(token)});` });
  }
  return { source: applyEdits(source, edits), functions, probes, mutation: mutated,
    package_name: packageName(tree), module_path: modulePath };
}

function testingImportName(tree) {
  for (const declaration of namedChildren(tree.rootNode)) {
    if (declaration.type !== "import_declaration") continue;
    const specs = namedChildren(declaration).flatMap((node) =>
      node.type === "import_spec_list" ? namedChildren(node) : [node]);
    for (const spec of specs) {
      const importPath = spec.childForFieldName("path")?.text;
      if (importPath !== "\"testing\"" && importPath !== "`testing`") continue;
      const alias = spec.childForFieldName("name")?.text ?? "testing";
      return ["_", "."].includes(alias) ? null : alias;
    }
  }
  return null;
}

function testingParameter(node, testing) {
  const parameters = namedChildren(node.childForFieldName("parameters"));
  if (parameters.length !== 1) return null;
  const names = parameters[0].children.filter(({ type }) => type === "identifier");
  const type = parameters[0].childForFieldName("type");
  const qualified = type?.type === "pointer_type" ? namedChildren(type)[0] : null;
  if (names.length !== 1 || names[0].text === "_" || qualified?.type !== "qualified_type" ||
      qualified.childForFieldName("package")?.text !== testing ||
      qualified.childForFieldName("name")?.text !== "T") return null;
  return names[0].text;
}

export async function instrumentGoTestFile({ source, selected }) {
  const tree = await parseSource("go", source);
  const testing = testingImportName(tree);
  const edits = [];
  const declared = [];
  for (const node of namedChildren(tree.rootNode)) {
    const name = node.type === "function_declaration" ? node.childForFieldName("name")?.text : null;
    if (name === null || !TEST_FUNCTION_RE.test(name) ||
        node.childForFieldName("type_parameters") !== null) continue;
    const parameter = testing === null ? null : testingParameter(node, testing);
    const body = node.childForFieldName("body");
    if (parameter === null || body === null) continue;
    declared.push(name);
    if (name !== selected) continue;
    edits.push({ index: bodyProbeIndex(body),
      insert: ` defer zzLauncherTestProofEnter(${parameter}, ${goString(name)})();` });
  }
  if (!declared.includes(selected)) unsupported("selected_test_not_observable", { test: selected });
  return { source: applyEdits(source, edits), package_name: packageName(tree), tests: declared };
}

function emitterSource({ prefix, channel, nonce, sourceId }) {
  return `var ${prefix}State struct {
\tsync.Mutex
\tseq int
}

func ${prefix}Emit(record map[string]any) {
\t${prefix}State.Lock()
\tdefer ${prefix}State.Unlock()
\trecord["v"] = 1
\trecord["nonce"] = ${goString(nonce)}
\trecord["src"] = ${goString(sourceId)}
\trecord["seq"] = ${prefix}State.seq
\tline, err := json.Marshal(record)
\tif err != nil {
\t\treturn
\t}
\tfile, err := os.OpenFile(${goString(channel)}, os.O_WRONLY|os.O_APPEND, 0)
\tif err != nil {
\t\treturn
\t}
\tdefer file.Close()
\tif _, err := file.Write(append(line, '\\n')); err == nil {
\t\t${prefix}State.seq++
\t}
}
`;
}

export function goObserverSource({ packageName: pkg, channel, nonce, file }) {
  return `// Code generated by the launcher test-proof observer. DO NOT EDIT.

package ${pkg}

import (
\t"encoding/json"
\t"fmt"
\t"os"
\t"sync"
\t"testing"
)

${emitterSource({ prefix: "zzLauncherTestProofObserver", channel, nonce, sourceId: "go.observer" })}
// The selected root lifecycle: the runner-started *testing.T whose name is the
// selected function's. A direct call with that same T, or a call of the
// selected function under another runtime name (as a subtest), runs unchanged
// and observes nothing. The first-registered cleanup runs after the selected
// test's subtests and every later-registered cleanup, so it closes the window
// and reports Go's own final outcome of the selected test.
var zzLauncherTestProofRoot struct {
\tsync.Mutex
\tt *testing.T
}

func zzLauncherTestProofEnter(t *testing.T, name string) func() {
\tzzLauncherTestProofRoot.Lock()
\troot := zzLauncherTestProofRoot.t == nil && t.Name() == name
\tif root {
\t\tzzLauncherTestProofRoot.t = t
\t}
\tzzLauncherTestProofRoot.Unlock()
\tif !root {
\t\treturn func() {}
\t}
\tpanicked := false
\tpanicMessage := ""
\ttest := []string{name}
\tzzLauncherTestProofObserverEmit(map[string]any{"kind": "test_start", "test": test, "file": ${goString(file)}})
\tt.Cleanup(func() {
\t\tzzLauncherTestProofObserverEmit(map[string]any{"kind": "window_end", "test": test,
\t\t\t"file": ${goString(file)}})
\t\tfailed := t.Failed() || panicked
\t\toutcome := "passed"
\t\tif failed {
\t\t\toutcome = "failed"
\t\t} else if t.Skipped() {
\t\t\toutcome = "skipped"
\t\t}
\t\tvar failure any
\t\tif panicked {
\t\t\tfailure = map[string]any{"name": "panic", "message": panicMessage}
\t\t} else if failed {
\t\t\tfailure = map[string]any{"name": "testing.T failure", "assertion": true}
\t\t}
\t\tzzLauncherTestProofObserverEmit(map[string]any{"kind": "test_result", "test": test,
\t\t\t"file": ${goString(file)}, "outcome": outcome, "assertion_failure": failed && !panicked,
\t\t\t"error": failure})
\t})
\t// Records a panic of the selected function body and re-raises it; Go runs
\t// the cleanup above before the re-raised panic ends the test binary.
\treturn func() {
\t\tif recovered := recover(); recovered != nil {
\t\t\tpanicked = true
\t\t\tpanicMessage = fmt.Sprint(recovered)
\t\t\tpanic(recovered)
\t\t}
\t}
}
`;
}

export function goReachSource({ packageName: pkg, channel, nonce }) {
  return `// Code generated by the launcher test-proof observer. DO NOT EDIT.

package ${pkg}

import (
\t"encoding/json"
\t"os"
\t"sync"
)

${emitterSource({ prefix: "zzLauncherTestProofReachSink", channel, nonce, sourceId: "go.reach" })}
func zzLauncherTestProofReach(token string) {
\tzzLauncherTestProofReachSinkEmit(map[string]any{"kind": "reach", "token": token})
}
`;
}
