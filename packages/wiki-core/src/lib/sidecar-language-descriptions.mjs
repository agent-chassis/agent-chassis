

import path from "node:path";

export const SIDECAR_LANGUAGE_DESCRIPTIONS = Object.freeze({
  go: Object.freeze({
    language: "go",
    grammar: "tree-sitter-go",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-go.wasm",
    extensions: Object.freeze([".go"]),
    constructs: Object.freeze(["import"])
  }),
  javascript: Object.freeze({
    language: "javascript",
    grammar: "tree-sitter-javascript",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-javascript.wasm",
    extensions: Object.freeze([".cjs", ".js", ".jsx", ".mjs"]),
    constructs: Object.freeze(["import", "require", "re_export_from", "dynamic_import"])
  }),
  python: Object.freeze({
    language: "python",
    grammar: "tree-sitter-python",
    grammarVersion: "0.25.0",
    wasmFile: "tree-sitter-python.wasm",
    extensions: Object.freeze([".py"]),

    declarationExtensions: Object.freeze([".pyi"]),
    constructs: Object.freeze(["import", "from_import"])
  }),
  rust: Object.freeze({
    language: "rust",
    grammar: "tree-sitter-rust",
    grammarVersion: "0.24.0",
    wasmFile: "tree-sitter-rust.wasm",
    extensions: Object.freeze([".rs"]),
    constructs: Object.freeze(["mod", "use", "extern_crate"])
  }),
  tsx: Object.freeze({
    language: "tsx",
    grammar: "tree-sitter-tsx",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-tsx.wasm",
    extensions: Object.freeze([".tsx"]),
    constructs: Object.freeze(["import", "require", "re_export_from", "dynamic_import"])
  }),
  typescript: Object.freeze({
    language: "typescript",
    grammar: "tree-sitter-typescript",
    grammarVersion: "0.23.2",
    wasmFile: "tree-sitter-typescript.wasm",
    extensions: Object.freeze([".cts", ".mts", ".ts"]),
    constructs: Object.freeze(["import", "require", "re_export_from", "dynamic_import"])
  })
});

const LANGUAGE_BY_EXTENSION = new Map(Object.entries(SIDECAR_LANGUAGE_DESCRIPTIONS)
  .flatMap(([key, description]) => description.extensions.map((extension) => [extension, key])));

export const SIDECAR_CODE_EXTENSIONS = Object.freeze([...LANGUAGE_BY_EXTENSION.keys()].sort());

export function sidecarLanguageForPath(relativePath) {
  return LANGUAGE_BY_EXTENSION.get(path.posix.extname(String(relativePath))) ?? null;
}

export function isSidecarCodeLanguagePath(relativePath) {
  return sidecarLanguageForPath(relativePath) !== null;
}

export function sidecarLanguageExtensions(languages, { declarations = false } = {}) {
  return Object.freeze(languages.flatMap((language) => {
    const description = SIDECAR_LANGUAGE_DESCRIPTIONS[language];
    if (!description) throw new TypeError(`unknown code language: ${language}`);
    return [...description.extensions, ...(declarations ? description.declarationExtensions ?? [] : [])];
  }));
}
