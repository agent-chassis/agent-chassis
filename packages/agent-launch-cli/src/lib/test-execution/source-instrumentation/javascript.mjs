

import { applyEdits, assertDistinctReplacement, namedChildren, parseSource, probeFacts, probeToken,
  unsupported } from "./index.mjs";

export const JAVASCRIPT_REACH_SYMBOL = "launcher.test-proof.reach";

const GRAMMARS = Object.freeze({
  ".js": "javascript", ".cjs": "javascript", ".mjs": "javascript", ".jsx": "javascript",
  ".ts": "typescript", ".cts": "typescript", ".mts": "typescript", ".tsx": "tsx"
});
const FUNCTION_TYPES = new Set(["function_declaration", "generator_function_declaration",
  "function_expression", "function", "generator_function", "arrow_function", "method_definition"]);
const TOP_LEVEL_WRAPPERS = new Set(["export_statement"]);

function grammarFor(modulePath) {
  const suffix = Object.keys(GRAMMARS).find((candidate) => modulePath.endsWith(candidate));
  if (suffix === undefined) unsupported("source_language_unsupported", { module_path: modulePath });
  return GRAMMARS[suffix];
}

function functionName(node) {
  const own = node.childForFieldName("name");
  if (own !== null) return own.text;
  const parent = node.parent;
  if (parent?.type === "variable_declarator") return parent.childForFieldName("name")?.text ?? null;
  if (parent?.type === "assignment_expression") return parent.childForFieldName("left")?.text ?? null;
  if (parent?.type === "pair") return parent.childForFieldName("key")?.text ?? null;
  if (["public_field_definition", "field_definition"].includes(parent?.type)) {
    return (parent.childForFieldName("name") ?? parent.childForFieldName("property"))?.text ?? null;
  }
  return null;
}

function probeIndex(body) {
  let index = body.startIndex + 1;
  for (const statement of namedChildren(body)) {
    const expression = statement.type === "expression_statement" ? namedChildren(statement)[0] : null;
    if (expression?.type !== "string") break;
    index = statement.endIndex;
  }
  return index;
}

function collectFunctions(node, found = []) {
  if (FUNCTION_TYPES.has(node.type)) {
    const body = node.childForFieldName("body");
    const name = functionName(node);
    if (body?.type === "statement_block" && name !== null) {
      found.push({ node, body, name, line: node.startPosition.row + 1 });
    }
  }
  for (const child of node.namedChildren) collectFunctions(child, found);
  return found;
}

function literalValue(node) {
  switch (node.type) {
    case "number": {
      const value = Number(node.text);
      if (!Number.isFinite(value) || /[_n]/u.test(node.text)) unsupported("return_literal_unsupported");
      return { value, kind: Number.isInteger(value) ? "integer" : "float" };
    }
    case "string": {
      if (node.text.includes("\\")) unsupported("return_literal_unsupported");
      return { value: node.text.slice(1, -1), kind: "string" };
    }
    case "template_string": {
      if (node.namedChildren.some(({ type }) => type !== "string_fragment") || node.text.includes("\\")) {
        unsupported("return_literal_unsupported");
      }
      return { value: node.text.slice(1, -1), kind: "string" };
    }
    case "true": return { value: true, kind: "boolean" };
    case "false": return { value: false, kind: "boolean" };
    case "null": return { value: null, kind: "null" };
    case "unary_expression": {
      const [operand] = namedChildren(node);
      if (node.childForFieldName("operator")?.text !== "-" || operand?.type !== "number") {
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
  (["integer", "float"].includes(original) && ["integer", "float"].includes(replacement));

function mutationTarget(tree, functionName) {
  const declarations = namedChildren(tree.rootNode)
    .flatMap((node) => TOP_LEVEL_WRAPPERS.has(node.type)
      ? namedChildren(node).filter(({ type }) => type !== "string") : [node])
    .filter((node) => ["function_declaration", "generator_function_declaration"].includes(node.type) &&
      node.childForFieldName("name")?.text === functionName);
  if (declarations.length === 0) unsupported("function_absent");
  if (declarations.length > 1) unsupported("function_not_unique");
  const [declaration] = declarations;
  if (declaration.type !== "function_declaration" ||
      declaration.children.some(({ type }) => type === "async" || type === "*")) {
    unsupported("function_not_synchronous");
  }
  const statements = namedChildren(declaration.childForFieldName("body"));
  if (statements.length !== 1 || statements[0].type !== "return_statement") {
    unsupported("body_not_single_scalar_return");
  }
  const returned = namedChildren(statements[0]);
  if (returned.length !== 1) unsupported("body_not_single_scalar_return");
  return { declaration, literal: returned[0] };
}

export async function instrumentJavaScriptModule({ source, modulePath, mutation = null }) {
  const tree = await parseSource(grammarFor(modulePath), source);
  const edits = [];
  let mutated = null;
  let mutatedDeclaration = null;
  if (mutation !== null) {
    const target = mutationTarget(tree, mutation.function_name);
    const original = literalValue(target.literal);
    const replacementKind = assertDistinctReplacement({ originalKind: original.kind,
      originalValue: original.value, replacement: mutation.replacement, compatible });
    edits.push({ index: target.literal.startIndex,
      remove: target.literal.endIndex - target.literal.startIndex,
      insert: JSON.stringify(mutation.replacement) });
    mutatedDeclaration = target.declaration;
    mutated = { function_name: mutation.function_name, line: target.declaration.startPosition.row + 1,
      original: original.value, original_kind: original.kind, replacement: mutation.replacement,
      replacement_kind: replacementKind };
  }
  const functions = collectFunctions(tree.rootNode);
  const probes = functions.map((fn) => {
    const token = probeToken();
    edits.push({ index: probeIndex(fn.body), insert:
      ` Reflect.get(globalThis, Symbol.for(${JSON.stringify(JAVASCRIPT_REACH_SYMBOL)}))?.(${JSON.stringify(token)});` });
    return probeFacts(token, fn.name, fn.line,
      mutatedDeclaration !== null && fn.node.id === mutatedDeclaration.id);
  });
  return {
    source: applyEdits(source, edits),
    functions: functions.map(({ name, line }) => ({ name, line })),
    probes,
    mutation: mutated
  };
}
