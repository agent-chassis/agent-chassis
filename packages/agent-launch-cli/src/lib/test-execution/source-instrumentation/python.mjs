

import { assertDistinctReplacement, namedChildren, parseSource, probeFacts, probeToken, unsupported }
  from "./index.mjs";

export const PYTHON_DIRECTIVE_MARKER = "#__launcher_test_proof__ ";

function isDocstring(node) {
  return node.type === "expression_statement" && namedChildren(node)[0]?.type === "string";
}

function literalValue(node) {
  switch (node.type) {
    case "integer": {
      const text = node.text.replaceAll("_", "");
      const value = /^0[0-9]/u.test(text) ? Number.NaN : Number(text);
      if (!Number.isSafeInteger(value)) unsupported("return_literal_unsupported");
      return { value, kind: "integer" };
    }
    case "float": {
      const value = Number(node.text.replaceAll("_", ""));
      if (!Number.isFinite(value) || /[jJ]$/u.test(node.text)) unsupported("return_literal_unsupported");
      return { value, kind: "float" };
    }
    case "string": {
      const quote = node.text[0];
      if (!["'", "\""].includes(quote) || node.text.includes("\\") || node.text.startsWith(quote.repeat(3)) ||
          namedChildren(node).some(({ type }) => type === "interpolation")) {
        unsupported("return_literal_unsupported");
      }
      return { value: node.text.slice(1, -1), kind: "string" };
    }
    case "true": return { value: true, kind: "boolean" };
    case "false": return { value: false, kind: "boolean" };
    case "none": return { value: null, kind: "null" };
    case "unary_operator": {
      const [operand] = namedChildren(node);
      if (!node.text.startsWith("-") || !["integer", "float"].includes(operand?.type)) {
        unsupported("return_literal_unsupported");
      }
      const inner = literalValue(operand);
      return { value: -inner.value, kind: inner.kind };
    }
    default:
      return unsupported("return_literal_unsupported");
  }
}

function collectFunctions(node, found = []) {
  for (const child of namedChildren(node)) {
    if (child.type === "function_definition") {
      found.push({ name: child.childForFieldName("name").text, line: child.startPosition.row + 1,
        top_level: node.type === "module" });
    }
    collectFunctions(child, found);
  }
  return found;
}

async function inspectPythonModule({ source, mutation = null }) {
  const tree = await parseSource("python", source);
  let mutated = null;
  if (mutation !== null) {
    const matches = namedChildren(tree.rootNode).filter((node) =>
      node.type === "function_definition" &&
      node.childForFieldName("name")?.text === mutation.function_name);
    if (matches.length === 0) unsupported("function_absent");
    if (matches.length > 1) unsupported("function_not_unique");
    const [declaration] = matches;
    if (declaration.children.some(({ type }) => type === "async")) unsupported("function_not_synchronous");
    const body = namedChildren(declaration.childForFieldName("body"));
    const statements = body.length > 1 && isDocstring(body[0]) ? body.slice(1) : body;
    const returned = statements.length === 1 && statements[0].type === "return_statement"
      ? namedChildren(statements[0]) : [];
    if (returned.length !== 1) unsupported("body_not_single_scalar_return");
    const original = literalValue(returned[0]);
    const replacementKind = assertDistinctReplacement({ originalKind: original.kind,
      originalValue: original.value, replacement: mutation.replacement, compatible: () => true });
    mutated = { function_name: mutation.function_name, line: declaration.startPosition.row + 1,
      original: original.value, original_kind: original.kind, replacement: mutation.replacement,
      replacement_kind: replacementKind };
  }
  return { functions: collectFunctions(tree.rootNode), mutation: mutated };
}

export async function instrumentPythonModule({ source, modulePath, mutation = null }) {
  const inspected = await inspectPythonModule({ source, mutation });
  const mutatedLine = inspected.mutation?.line ?? null;
  const probes = inspected.functions.map((fn) => probeFacts(probeToken(), fn.name, fn.line,
    fn.top_level && fn.line === mutatedLine && fn.name === inspected.mutation.function_name));
  const directive = {
    original_bytes: Buffer.byteLength(source, "utf8"),
    probes: Object.fromEntries(probes.map((probe) => [`${probe.line}:${probe.function_name}`, probe.token])),
    mutation: inspected.mutation === null ? null
      : { function_name: inspected.mutation.function_name, line: inspected.mutation.line,
        replacement: inspected.mutation.replacement }
  };
  const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
  return {
    source: `${source}${separator}${PYTHON_DIRECTIVE_MARKER}${JSON.stringify(directive)}\n`,
    functions: inspected.functions.map(({ name, line }) => ({ name, line })),
    probes,
    mutation: inspected.mutation,
    module_path: modulePath
  };
}
