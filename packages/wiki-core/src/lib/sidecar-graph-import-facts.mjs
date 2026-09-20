import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Language, Parser } from "web-tree-sitter";

const PYTHON_RELATIVE_IMPORT_PREFIX = /^\.+/;
const WASM_GRAMMAR_PACKAGE_NAME = "@vscode/tree-sitter-wasm";
const require = createRequire(import.meta.url);
const WEB_TREE_SITTER_ROOT = path.dirname(require.resolve("web-tree-sitter"));
const WASM_GRAMMAR_ROOT = path.dirname(
  require.resolve(`${WASM_GRAMMAR_PACKAGE_NAME}/package.json`)
);
const WEB_TREE_SITTER_VERSION = readPackageVersion(
  path.join(WEB_TREE_SITTER_ROOT, "package.json")
);
const WASM_GRAMMAR_PACKAGE_VERSION = readPackageVersion(
  path.join(WASM_GRAMMAR_ROOT, "package.json")
);

const LANGUAGE_SPECS = Object.freeze({
  javascript: {
    language: "javascript",
    grammar: "tree-sitter-javascript",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-javascript.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  },
  python: {
    language: "python",
    grammar: "tree-sitter-python",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-python.wasm",
    constructs: ["import", "from_import"]
  },
  tsx: {
    language: "tsx",
    grammar: "tree-sitter-tsx",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-tsx.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  },
  typescript: {
    language: "typescript",
    grammar: "tree-sitter-typescript",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-typescript.wasm",
    constructs: ["import", "require", "re_export_from", "dynamic_import"]
  }
});

let treeSitterProviderPromise = null;

function readPackageVersion(packageJsonPath) {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return parsed.version;
}

function languageKeyForPath(relativePath) {
  const extension = path.posix.extname(relativePath);
  if (extension === ".py") return "python";
  if (extension === ".tsx") return "tsx";
  if ([".ts", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".cjs", ".js", ".jsx", ".mjs"].includes(extension)) return "javascript";
  return null;
}

function wasmGrammarPath(wasmFile) {
  return path.join(WASM_GRAMMAR_ROOT, "wasm", wasmFile);
}

export async function loadTreeSitterProvider() {
  if (!treeSitterProviderPromise) {
    treeSitterProviderPromise = loadTreeSitterProviderUncached();
  }
  return treeSitterProviderPromise;
}

async function loadTreeSitterProviderUncached() {
  try {
    await Parser.init({
      locateFile(file) {
        return path.join(WEB_TREE_SITTER_ROOT, file);
      }
    });

    const languages = new Map();
    for (const [key, spec] of Object.entries(LANGUAGE_SPECS)) {
      languages.set(key, await Language.load(wasmGrammarPath(spec.wasmFile)));
    }
    return { available: true, languages };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function providerDescriptorForLanguage(languageKey) {
  const spec = LANGUAGE_SPECS[languageKey];
  return {
    name: "web-tree-sitter",
    runtime: "wasm",
    runtime_version: WEB_TREE_SITTER_VERSION,
    grammar: spec.grammar,
    grammar_version: spec.grammarVersion,
    cache_key: `web-tree-sitter@${WEB_TREE_SITTER_VERSION}:${WASM_GRAMMAR_PACKAGE_NAME}@${WASM_GRAMMAR_PACKAGE_VERSION}:${spec.grammar}@${spec.grammarVersion}`
  };
}

export function coverageForLanguage(languageKey) {
  const spec = LANGUAGE_SPECS[languageKey];
  return {
    language: spec.language,
    status: "parsed",
    constructs: spec.constructs
  };
}

function textForNode(text, node) {
  return text.slice(node.startIndex, node.endIndex);
}

function namedChildren(node) {
  return Array.from({ length: node.namedChildCount }, (_, index) => node.namedChild(index));
}

function firstNamedChildOfType(node, type) {
  return namedChildren(node).find((child) => child?.type === type) ?? null;
}

function firstArgumentNode(callNode) {
  const argumentsNode = firstNamedChildOfType(callNode, "arguments");
  return argumentsNode ? namedChildren(argumentsNode)[0] ?? null : null;
}

function stringLiteralValue(text, node) {
  if (!node || node.type !== "string") return null;
  const raw = textForNode(text, node);
  if (raw.length < 2) return null;
  const quote = raw[0];
  if ((quote !== "\"" && quote !== "'") || raw.at(-1) !== quote) return null;
  return raw.slice(1, -1);
}

function collectJavaScriptImportFacts({ rootNode, text, languageKey }) {
  const facts = [];

  function addLiteralFact({ node, sourceNode, construct }) {
    const specifier = stringLiteralValue(text, sourceNode);
    if (specifier == null) return;
    facts.push({
      construct,
      dynamic: false,
      index: node.startIndex,
      languageKey,
      specifier
    });
  }

  function addDynamicFact({ node, argumentNode, construct }) {
    const specifier = stringLiteralValue(text, argumentNode);
    facts.push({
      construct,
      dynamic: specifier == null,
      index: node.startIndex,
      languageKey,
      raw_specifier: argumentNode ? textForNode(text, argumentNode) : null,
      specifier
    });
  }

  function visit(node) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source") || firstNamedChildOfType(node, "string");
      addLiteralFact({ node, sourceNode, construct: "import" });
    } else if (node.type === "export_statement") {
      const sourceNode = firstNamedChildOfType(node, "string");
      if (sourceNode) addLiteralFact({ node, sourceNode, construct: "re_export_from" });
    } else if (node.type === "call_expression") {
      const functionNode = node.childForFieldName("function") || namedChildren(node)[0];
      const functionText = functionNode ? textForNode(text, functionNode) : "";
      if (functionNode?.type === "import") {
        addDynamicFact({
          node,
          argumentNode: firstArgumentNode(node),
          construct: "dynamic_import"
        });
      } else if (functionText === "require") {
        addDynamicFact({
          node,
          argumentNode: firstArgumentNode(node),
          construct: "require"
        });
      }
    }

    for (const child of namedChildren(node)) visit(child);
  }

  visit(rootNode);
  return facts.sort((left, right) => left.index - right.index);
}

function pythonRelativeImportToLocalSpecifier(value) {
  const prefix = value.match(PYTHON_RELATIVE_IMPORT_PREFIX)?.[0] ?? "";
  if (!prefix) return null;
  const remainder = value.slice(prefix.length);
  const directoryPrefix =
    prefix.length === 1 ? "." : Array.from({ length: prefix.length - 1 }, () => "..").join("/");
  return `${directoryPrefix}/${remainder.replaceAll(".", "/")}`.replace(/\/$/, "");
}

function firstPythonImportName(node, text) {
  const named = namedChildren(node);
  const aliased = named.find((child) => child.type === "aliased_import");
  if (aliased) {
    const dotted = firstNamedChildOfType(aliased, "dotted_name");
    return dotted ? textForNode(text, dotted) : null;
  }
  const dotted = named.find((child) => child.type === "dotted_name");
  return dotted ? textForNode(text, dotted) : null;
}

function collectPythonImportFacts({ rootNode, text, languageKey }) {
  const facts = [];

  function visit(node) {
    if (node.type === "import_statement") {
      for (const child of namedChildren(node)) {
        const specifier = child.type === "aliased_import"
          ? firstPythonImportName(child, text)
          : textForNode(text, child);
        if (specifier) {
          facts.push({
            construct: "import",
            dynamic: false,
            index: child.startIndex,
            languageKey,
            specifier
          });
        }
      }
    } else if (node.type === "import_from_statement") {
      const importRoot = namedChildren(node).find((child) =>
        ["relative_import", "dotted_name"].includes(child.type)
      );
      if (importRoot) {
        const rawSpecifier = textForNode(text, importRoot);
        facts.push({
          construct: "from_import",
          dynamic: false,
          index: node.startIndex,
          languageKey,
          raw_specifier: rawSpecifier,
          specifier: importRoot.type === "relative_import"
            ? pythonRelativeImportToLocalSpecifier(rawSpecifier)
            : rawSpecifier
        });
      }
    }

    for (const child of namedChildren(node)) visit(child);
  }

  visit(rootNode);
  return facts.sort((left, right) => left.index - right.index);
}

export function parseImportFacts({ provider, relativePath, text }) {
  const languageKey = languageKeyForPath(relativePath);
  const language = provider.languages.get(languageKey);
  if (!languageKey || !language) {
    return { facts: [], unavailable: true, reason: "unsupported_language" };
  }

  const parser = new Parser();
  let tree = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse(text);
    const facts = languageKey === "python"
      ? collectPythonImportFacts({ rootNode: tree.rootNode, text, languageKey })
      : collectJavaScriptImportFacts({ rootNode: tree.rootNode, text, languageKey });
    return { facts, unavailable: false };
  } catch (error) {
    return {
      facts: [],
      unavailable: true,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    tree?.delete();
    parser.delete();
  }
}
