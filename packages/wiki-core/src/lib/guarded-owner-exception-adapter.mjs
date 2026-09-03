import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Language, Parser } from "web-tree-sitter";

import { defineGuardedOwnerCategoryAdapter } from "./guarded-owner-registry.mjs";

export const GUARDED_OWNER_EXCEPTION_DIAGNOSTICS = Object.freeze({
  CORPUS_INVALID: "guarded_owner_exception_corpus_invalid",
  DUPLICATE_OWNER: "guarded_owner_exception_duplicate_owner",
  PARSE_FAILED: "guarded_owner_exception_parse_failed",
  PROOF_IDENTITY_INVALID: "guarded_owner_exception_proof_identity_invalid",
  SUPPRESSION_UNBOUNDED: "guarded_owner_exception_suppression_unbounded",
  UNRESOLVED: "guarded_owner_exception_unresolved"
});

const PRODUCTION_ROOTS = Object.freeze([
  "packages/*/src",
  "packages/*/lib",
  "tools"
]);
const PROOF_SELECTOR = /^tests\/(?:integration|unit)\/[a-zA-Z0-9._/-]+\.test\.mjs(?:::[^\n]+)?$/u;
const REPO_PATH = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u;
const SOURCE_ID = /^(?<file>[a-zA-Z0-9._/-]+)#(?<identity>[^\n#]+)$/u;
const CODE_IDENTITY = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+\.v[0-9]+)$/u;
const EXCLUDED_PRODUCTION_SEGMENTS = new Set([
  ".agent-runs", ".cache", "cache", "caches", "coverage", "dist", "docs",
  "fixture", "fixtures", "generated", "node_modules", "test", "tests", "wiki"
]);
const require = createRequire(import.meta.url);
const WEB_TREE_SITTER_ROOT = path.dirname(require.resolve("web-tree-sitter"));
const WASM_GRAMMAR_ROOT = path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json"));
const DEFAULT_REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
const DEFAULT_EXCEPTION_CORPUS = path.resolve(import.meta.dirname, "../../data/exception-disposition-census.v1.json");
const DEFAULT_REFUSAL_CORPUS = path.resolve(import.meta.dirname, "../../data/refusal-emission-census.v1.json");
const DEFAULT_ASYNC_CORPUS = path.join(DEFAULT_REPOSITORY_ROOT, "tests/fixtures/async-failure-census.v1.json");

let languagePromise;

export class GuardedOwnerExceptionAdapterError extends Error {
  constructor(code, details) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = "GuardedOwnerExceptionAdapterError";
    this.code = code;
    this.details = Object.freeze(details);
  }
}

function fail(code, details) {
  throw new GuardedOwnerExceptionAdapterError(code, details);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sourcePoint(node) {
  return Object.freeze({
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1
  });
}

export function isGuardedOwnerProductionPath(candidate) {
  if (typeof candidate !== "string" || !REPO_PATH.test(candidate) ||
      !candidate.endsWith(".mjs") || candidate.endsWith(".test.mjs")) return false;
  const segments = candidate.split("/");
  if (segments.some((segment) => EXCLUDED_PRODUCTION_SEGMENTS.has(segment)) ||
      segments.some((segment) => segment.endsWith(".generated"))) return false;
  return /^packages\/[^/]+\/(?:src|lib)\/.+\.mjs$/u.test(candidate) ||
    /^tools\/.+\.mjs$/u.test(candidate);
}

async function javascriptLanguage() {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init({ locateFile: (file) => path.join(WEB_TREE_SITTER_ROOT, file) });
      return Language.load(path.join(WASM_GRAMMAR_ROOT, "wasm", "tree-sitter-javascript.wasm"));
    })();
  }
  return languagePromise;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

function nodeText(node, source) {
  return source.slice(node.startIndex, node.endIndex);
}

function firstExecutableStatement(body) {
  return body?.namedChildren.find((child) => child.type !== "comment") ?? null;
}

function isEntryRethrow(catchNode, source) {
  const parameter = catchNode.childForFieldName("parameter");
  const body = catchNode.childForFieldName("body");
  const first = firstExecutableStatement(body);
  if (!parameter || parameter.type !== "identifier" || first?.type !== "throw_statement") return false;
  const thrown = first.namedChildren.find((child) => child.type !== "comment") ?? null;
  return thrown?.type === "identifier" && nodeText(thrown, source) === nodeText(parameter, source);
}

function enclosingNodes(node, limit = 6) {
  const result = [];
  let cursor = node.parent;
  while (cursor && result.length < limit) {
    result.push(cursor);
    cursor = cursor.parent;
  }
  return result;
}

function registeredCollectionUse(node, source) {
  let cursor = node.parent;
  let structuralDepth = 0;
  while (cursor && structuralDepth < 10) {
    if (cursor.type === "variable_declarator") {
      const name = cursor.childForFieldName("name");
      return Boolean(name && /(?:^|_)(?:CODE|CODES|DIAGNOSTIC|DIAGNOSTICS|ERROR|ERRORS|REFUSAL|REFUSALS)(?:_|$)/u
        .test(nodeText(name, source)));
    }
    if (["pair", "object", "array", "arguments", "call_expression", "new_expression",
      "parenthesized_expression", "lexical_declaration", "export_statement"].includes(cursor.type)) {
      structuralDepth += 1;
      cursor = cursor.parent;
      continue;
    }
    break;
  }
  return false;
}

function qualifyingCodeUse(node, source) {
  for (const ancestor of enclosingNodes(node)) {
    if (["throw_statement", "switch_case"].includes(ancestor.type)) return ancestor.type;
    if (ancestor.type === "binary_expression" && /(?:===|!==|==|!=)/u.test(nodeText(ancestor, source))) {
      return "code_comparison";
    }
    if (ancestor.type === "new_expression") {
      const constructor = ancestor.childForFieldName("constructor");
      if (constructor && /Error$/u.test(nodeText(constructor, source))) return "error_construction";
    }
    if (ancestor.type === "call_expression") {
      const called = ancestor.childForFieldName("function");
      const callee = called ? nodeText(called, source) : "";
      if (/(?:^|\.)(?:reject|fail|errorContent)$/u.test(callee) ||
          /(?:Error|Refusal|Result|Diagnostic|Envelope|Translation)/u.test(callee)) {
        return callee.endsWith("reject") ? "promise_rejection" : "public_result_construction";
      }
    }
  }
  return registeredCollectionUse(node, source) ? "registered_code_collection" : null;
}

function decodeStringLiteral(raw) {
  if (raw.length < 2) return null;
  const quote = raw[0];
  if ((quote !== "\"" && quote !== "'") || raw.at(-1) !== quote) return null;
  const body = raw.slice(1, -1);
  if (!body.includes("\\")) return body;
  if (quote === "\"") {
    try { return JSON.parse(raw); } catch { return null; }
  }

  if (/\\(?:u|x|\r|\n|\r|\n)/u.test(body)) return null;
  return body.replaceAll("\\'", "'").replaceAll("\\\\", "\\");
}

function ancestorOfType(node, type) {
  let cursor = node.parent;
  while (cursor) {
    if (cursor.type === type) return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function exportedFunctionBoundary(node, source) {
  let cursor = node.parent;
  let functionNode = null;
  while (cursor && cursor.type !== "program") {
    if (["function_declaration", "function_expression", "arrow_function", "method_definition"].includes(cursor.type)) {
      functionNode = cursor;
      break;
    }
    cursor = cursor.parent;
  }
  if (!functionNode) return false;
  cursor = functionNode.parent;
  while (cursor && cursor.type !== "program") {
    if (cursor.type === "export_statement") {
      const name = functionNode.childForFieldName("name");
      const declaration = name ? nodeText(name, source) : nodeText(functionNode, source).slice(0, 160);
      return /^(?:public|expose|publish)|(?:PublicBoundary|PublicRoute|PublicHandler)$/u.test(declaration);
    }
    if (["function_declaration", "function_expression", "arrow_function", "method_definition"].includes(cursor.type)) return false;
    cursor = cursor.parent;
  }
  return false;
}

function rawErrorValue(node, source) {
  if (!node) return true;
  if (node.type !== "new_expression") return true;
  const constructor = node.childForFieldName("constructor");
  return !constructor || nodeText(constructor, source) === "Error";
}

function lineTextAt(source, line) {
  return source.split(/\r?\n/u)[line - 1] ?? "";
}

function mechanicalDefect(code, node, source, details = {}) {
  const point = sourcePoint(node);
  return Object.freeze({ code, ...point, details: Object.freeze({ source_line: lineTextAt(source, point.line).trim(), ...details }) });
}

export async function discoverGuardedMechanicalDefects({ path: sourcePath, source }) {
  if (!REPO_PATH.test(sourcePath) || typeof source !== "string") {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { location: "mechanical_discovery_input" });
  }
  const language = await javascriptLanguage();
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (tree.rootNode.hasError) fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.PARSE_FAILED, { path: sourcePath });
    const defects = [];
    walk(tree.rootNode, (node) => {
      if (node.type === "catch_clause" && exportedFunctionBoundary(node, source) && !isEntryRethrow(node, source)) {
        const parameter = node.childForFieldName("parameter");
        const body = node.childForFieldName("body");
        const executable = body?.namedChildren.filter((child) => child.type !== "comment") ?? [];
        const bodyText = body ? nodeText(body, source) : "";
        const hasExit = executable.some((child) => ["return_statement", "throw_statement"].includes(child.type));
        const logOnly = executable.length > 0 && executable.every((child) =>
          child.type === "expression_statement" && /\b(?:console|log|logger)\b/u.test(nodeText(child, source))
        );
        if (!hasExit && (executable.length === 0 || logOnly)) {
          defects.push(mechanicalDefect("guarded_owner_lint_swallowed_catch", node, source));
          if (!parameter) defects.push(mechanicalDefect("guarded_owner_lint_anonymous_suppression", node, source));
        }
        if (/\b(?:best[- ]effort|graceful[- ]degradation|fallback)\b/iu.test(bodyText) &&
            !/\b(?:no|not|never|without|prohibit(?:ed|s)?)\b[^\n]{0,40}\b(?:best[- ]effort|graceful[- ]degradation|fallback)\b/iu.test(bodyText)) {
          defects.push(mechanicalDefect("guarded_owner_lint_prohibited_fallback_comment", node, source));
        }
      }
      if (node.type === "throw_statement" && exportedFunctionBoundary(node, source)) {
        const thrown = node.namedChildren.find((child) => child.type !== "comment") ?? null;
        if (rawErrorValue(thrown, source)) {
          defects.push(mechanicalDefect("guarded_owner_lint_raw_public_throw", node, source));
        }
      }
      if (node.type === "call_expression" && exportedFunctionBoundary(node, source)) {
        const called = node.childForFieldName("function");
        if (called && nodeText(called, source) === "Promise.reject") {
          const argumentsNode = node.childForFieldName("arguments");
          const rejected = argumentsNode?.namedChildren.find((child) => child.type !== "comment") ?? null;
          if (rawErrorValue(rejected, source)) {
            defects.push(mechanicalDefect("guarded_owner_lint_raw_public_rejection", node, source));
          }
        }
      }
      if (node.type === "object") {
        const keys = new Set(node.namedChildren.filter((child) => child.type === "pair").map((pair) => {
          const key = pair.childForFieldName("key");
          return key ? nodeText(key, source).replace(/^['"]|['"]$/gu, "") : "";
        }));
        if (keys.has("isError") && !keys.has("content") && exportedFunctionBoundary(node, source)) {
          defects.push(mechanicalDefect("guarded_owner_lint_malformed_public_envelope", node, source));
        }
        if (keys.has("translator") && !keys.has("owner") && exportedFunctionBoundary(node, source)) {
          defects.push(mechanicalDefect("guarded_owner_lint_malformed_translator_binding", node, source));
        }
      }
      if (["function_declaration", "function_expression", "arrow_function"].includes(node.type)) {
        const name = node.childForFieldName("name");
        const text = nodeText(node, source);
        const inferredName = name ? nodeText(name, source) : text.slice(0, 120);
        if (/public.*refusal|refusal.*builder|build.*refusal/iu.test(inferredName) &&
            /\/(?:routes?|register)(?:\/|\.)/u.test(sourcePath) &&
            !/\b(?:errorContent|create[A-Za-z0-9]*Refusal|translate[A-Za-z0-9]*Refusal)\b/u.test(text)) {
          defects.push(mechanicalDefect("guarded_owner_lint_route_local_refusal_builder", node, source));
        }
      }
      if (node.type === "comment") {
        const comment = nodeText(node, source);
        if (/^\s*(?:\/\/|\/\*)\s*(?:eslint-disable(?!-next-line\s+[a-z@])|noqa\b(?!:\s*[A-Z0-9,]+))/iu.test(comment) ||
            /guarded[-_ ]owner[^\n]*(?:disable|ignore|suppress)/iu.test(comment)) {
          defects.push(mechanicalDefect("guarded_owner_lint_broad_or_inline_bypass", node, source));
        }
      }
    });
    const codeSites = await discoverGuardedCatchAndCodeSites({ path: sourcePath, source });
    for (const site of codeSites.code_literals) {
      if (/^(?:default_error|generic_error|internal_error|unknown_error|unexpected_error)$/u.test(site.code)) {
        defects.push(Object.freeze({
          code: "guarded_owner_lint_placeholder_error_identity",
          line: site.line,
          column: site.column,
          details: Object.freeze({ source_line: lineTextAt(source, site.line).trim(), identity: site.code })
        }));
      }
    }
    return Object.freeze(defects.sort((left, right) => left.line - right.line ||
      left.column - right.column || left.code.localeCompare(right.code)));
  } catch (error) {
    if (error instanceof GuardedOwnerExceptionAdapterError) throw error;
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.PARSE_FAILED, {
      path: sourcePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  } finally {
    tree?.delete();
    parser.delete();
  }
}

export async function discoverGuardedCatchAndCodeSites({ path: sourcePath, source, codeLiterals = [] }) {
  if (!REPO_PATH.test(sourcePath) || typeof source !== "string" || !Array.isArray(codeLiterals)) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { location: "discovery_input" });
  }
  const language = await javascriptLanguage();
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (tree.rootNode.hasError) {
      fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.PARSE_FAILED, { path: sourcePath });
    }
    const wantedCodes = new Set(codeLiterals);
    const catches = [];
    const excludedRethrows = [];
    const codes = [];
    const knownCodeByMember = new Map([...wantedCodes].map((code) => [
      code.replace(/[^a-zA-Z0-9]+/gu, "_").toUpperCase(), code
    ]));
    let catchOrdinal = 0;
    let codeOrdinal = 0;
    let syntacticOrdinal = 0;
    walk(tree.rootNode, (node) => {
      if (node.type === "catch_clause") {
        catchOrdinal += 1;
        syntacticOrdinal += 1;
        if (isEntryRethrow(node, source)) {
          excludedRethrows.push(Object.freeze({
            ...sourcePoint(node), ordinal: catchOrdinal, syntactic_ordinal: syntacticOrdinal
          }));
          return;
        }
        catches.push(Object.freeze({
          ...sourcePoint(node),
          kind: "catch_clause",
          ordinal: catchOrdinal,
          syntactic_ordinal: syntacticOrdinal
        }));
      } else if (node.type === "string") {
        const literal = decodeStringLiteral(source.slice(node.startIndex, node.endIndex));
        const useKind = literal === null ? null : qualifyingCodeUse(node, source);
        if (literal !== null && useKind && (CODE_IDENTITY.test(literal) || wantedCodes.has(literal))) {
          codeOrdinal += 1;
          syntacticOrdinal += 1;
          codes.push(Object.freeze({
            ...sourcePoint(node),
            kind: "code_literal",
            code: literal,
            ordinal: codeOrdinal,
            syntactic_ordinal: syntacticOrdinal,
            use_kind: useKind
          }));
        }
      } else if (node.type === "member_expression" && knownCodeByMember.size > 0) {
        const property = node.childForFieldName("property");
        const code = property ? knownCodeByMember.get(nodeText(property, source)) : null;
        if (code) {
          codeOrdinal += 1;
          syntacticOrdinal += 1;
          codes.push(Object.freeze({
            ...sourcePoint(node),
            kind: "code_literal",
            code,
            ordinal: codeOrdinal,
            syntactic_ordinal: syntacticOrdinal,
            use_kind: "closed_enum_member"
          }));
        }
      }
    });
    return Object.freeze({
      catches: Object.freeze(catches),
      code_literals: Object.freeze(codes),
      excluded_entry_rethrows: Object.freeze(excludedRethrows)
    });
  } catch (error) {
    if (error instanceof GuardedOwnerExceptionAdapterError) throw error;
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.PARSE_FAILED, {
      path: sourcePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  } finally {
    tree?.delete();
    parser.delete();
  }
}

async function readJson(filePath, read) {
  let value;
  try {
    value = JSON.parse(await read(filePath, "utf8"));
  } catch (error) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!plainObject(value)) fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { path: filePath });
  return value;
}

function validateProof(proof, sourceId) {
  if (typeof proof !== "string" || !PROOF_SELECTOR.test(proof)) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.PROOF_IDENTITY_INVALID, { source_id: sourceId, proof });
  }
  return proof;
}

function addOwner(index, key, owner) {
  if (index.has(key)) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.DUPLICATE_OWNER, {
      source_identity: key,
      owners: [index.get(key).semantic_owner, owner.semantic_owner]
    });
  }
  index.set(key, Object.freeze(owner));
}

function buildOwnerIndexes(exceptionCorpus, refusalCorpus, asyncCorpus) {
  if (exceptionCorpus.schema_version !== "exception-disposition-census.v1" ||
      exceptionCorpus.owner !== "WK-2359" || !Array.isArray(exceptionCorpus.entries) ||
      exceptionCorpus.entry_count !== exceptionCorpus.entries.length ||
      refusalCorpus.schema_version !== "refusal-emission-census.v1" ||
      refusalCorpus.owner !== "WK-2359" || !Array.isArray(refusalCorpus.entries) ||
      refusalCorpus.entry_count !== refusalCorpus.entries.length ||
      asyncCorpus.schema_version !== "async-failure-census.v1" ||
      asyncCorpus.work_record !== "WK-2382" || !plainObject(asyncCorpus.populations)) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { location: "corpus_header" });
  }

  const catches = new Map();
  const codes = new Map();
  const asyncSites = new Map();
  const knownCodes = new Set();

  for (const entry of exceptionCorpus.entries) {
    const match = typeof entry.source_id === "string" ? entry.source_id.match(SOURCE_ID) : null;
    if (!match || entry.source_file !== match.groups.file ||
        entry.source_id !== `${entry.source_file}#catch${entry.catch_ordinal}` ||
        !["WK-2359", "WK-2382"].includes(entry.semantic_owner)) {
      fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { source_id: entry.source_id });
    }
    const suppression = entry.disposition === "proven_safe_suppression";
    if (suppression) validateProof(entry.behavioural_witness, entry.source_id);
    addOwner(catches, entry.source_id, {
      owner_entry_id: `WK-2359:${entry.source_id}`,
      semantic_owner: entry.semantic_owner,
      owner_corpus: "exception-disposition-census.v1",
      disposition: entry.disposition,
      proof_identity: suppression ? entry.behavioural_witness : null,
      suppression: suppression ? Object.freeze({ finite: true, witness: entry.behavioural_witness }) : null
    });
  }

  for (const entry of refusalCorpus.entries) {
    if (typeof entry.source_file !== "string" || typeof entry.emitted_code !== "string" ||
        entry.source_id !== `${entry.source_file}#${entry.emitted_code}` || entry.procedure_only !== false) {
      fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { source_id: entry.source_id });
    }
    knownCodes.add(entry.emitted_code);
    addOwner(codes, entry.source_id, {
      owner_entry_id: `WK-2359:${entry.source_id}`,
      semantic_owner: "WK-2359",
      owner_corpus: "refusal-emission-census.v1",
      disposition: entry.semantic_category,
      proof_identity: null,
      suppression: null
    });
  }

  for (const [population, definition] of Object.entries(asyncCorpus.populations)) {
    if (!plainObject(definition) || !Array.isArray(definition.sites)) {
      fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { population });
    }
    for (const site of definition.sites) {
      validateProof(site.witness, `${site.module}#${site.symbol}`);
      const key = `${site.module}#${population}:${site.symbol}:${site.occurrence}`;
      addOwner(asyncSites, key, {
        owner_entry_id: `WK-2382:${key}`,
        semantic_owner: "WK-2382",
        owner_corpus: "async-failure-census.v1",
        disposition: site.disposition,
        proof_identity: site.witness,
        suppression: site.disposition.includes("suppression") || site.disposition.includes("suppressed")
          ? Object.freeze({ finite: true, witness: site.witness }) : null,
        anchor: site.anchor,
        occurrence: site.occurrence,
        source_file: site.module
      });
    }
  }
  return { catches, codes, asyncSites, knownCodes: [...knownCodes].sort() };
}

function resolveAsyncCatch(asyncSites, sourceFile, source, line) {
  const before = source.split(/\r?\n/u).slice(0, line).join("\n");
  const matches = [];
  for (const owner of asyncSites.values()) {
    if (owner.source_file !== sourceFile || typeof owner.anchor !== "string") continue;
    const anchorIndex = before.lastIndexOf(owner.anchor);
    if (anchorIndex !== -1) matches.push({ owner, anchorIndex });
  }
  matches.sort((a, b) => b.anchorIndex - a.anchorIndex || a.owner.owner_entry_id.localeCompare(b.owner.owner_entry_id));
  return matches[0]?.owner ?? null;
}

function unresolvedFact(site, owner) {
  return Object.freeze({
    diagnostic_id: GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.UNRESOLVED,
    source_identity: site.source_identity,
    site_kind: site.site_kind,
    candidate_semantic_owner: owner,
    expires: "repository_milestone:WK-2361",
    falsifying_selector: owner === "WK-2382"
      ? "node --test tests/unit/async-failure-census.test.mjs"
      : "node --test tests/unit/refusal-emission-census.test.mjs"
  });
}

export async function reconcileGuardedOwnerExceptionPopulation({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  trackedPaths,
  read = readFile,
  exceptionCorpusPath = DEFAULT_EXCEPTION_CORPUS,
  refusalCorpusPath = DEFAULT_REFUSAL_CORPUS,
  asyncCorpusPath = DEFAULT_ASYNC_CORPUS
}) {
  if (!Array.isArray(trackedPaths) || typeof repositoryRoot !== "string") {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { location: "reconciliation_input" });
  }
  const [exceptionCorpus, refusalCorpus, asyncCorpus] = await Promise.all([
    readJson(exceptionCorpusPath, read), readJson(refusalCorpusPath, read), readJson(asyncCorpusPath, read)
  ]);
  const indexes = buildOwnerIndexes(exceptionCorpus, refusalCorpus, asyncCorpus);
  const sites = [];
  const sortedPaths = [...new Set(trackedPaths.filter(isGuardedOwnerProductionPath))].sort();
  const seenCatchOwners = new Set();
  const seenCodeOwners = new Set();
  for (const sourceFile of sortedPaths) {
    const source = await read(path.join(repositoryRoot, sourceFile), "utf8");
    const found = await discoverGuardedCatchAndCodeSites({
      path: sourceFile, source, codeLiterals: indexes.knownCodes
    });
    for (const site of found.excluded_entry_rethrows) {
      const sourceIdentity = `${sourceFile}#catch${site.ordinal}`;
      if (indexes.catches.has(sourceIdentity)) seenCatchOwners.add(sourceIdentity);
    }
    for (const site of found.catches) {
      const sourceIdentity = `${sourceFile}#catch${site.ordinal}`;
      const owner = indexes.catches.get(sourceIdentity) ??
        resolveAsyncCatch(indexes.asyncSites, sourceFile, source, site.line);
      if (indexes.catches.has(sourceIdentity)) seenCatchOwners.add(sourceIdentity);
      sites.push(Object.freeze({
        source_identity: sourceIdentity,
        source_file: sourceFile,
        line: site.line,
        column: site.column,
        syntactic_ordinal: site.syntactic_ordinal,
        site_kind: "catch_clause",
        owner: owner ?? null,
        unresolved_fact: owner ? null : unresolvedFact({ source_identity: sourceIdentity, site_kind: "catch_clause" }, "WK-2382")
      }));
    }
    for (const site of found.code_literals) {
      const sourceIdentity = `${sourceFile}#${site.code}`;
      const owner = indexes.codes.get(sourceIdentity) ?? null;
      if (owner) seenCodeOwners.add(sourceIdentity);
      sites.push(Object.freeze({
        source_identity: `${sourceIdentity}@code${site.ordinal}`,
        owner_lookup_identity: sourceIdentity,
        source_file: sourceFile,
        line: site.line,
        column: site.column,
        syntactic_ordinal: site.syntactic_ordinal,
        site_kind: "code_literal",
        code: site.code,
        use_kind: site.use_kind,
        owner,
        unresolved_fact: owner ? null : unresolvedFact({ source_identity: `${sourceIdentity}@code${site.ordinal}`, site_kind: "code_literal" }, "WK-2359")
      }));
    }
  }
  sites.sort((left, right) => left.source_file.localeCompare(right.source_file) ||
    left.syntactic_ordinal - right.syntactic_ordinal ||
    left.site_kind.localeCompare(right.site_kind) || left.line - right.line || left.column - right.column);
  const ownerSiteAbsences = Object.freeze([
    ...[...indexes.catches.keys()].filter((identity) => !seenCatchOwners.has(identity)),
    ...[...indexes.codes.keys()].filter((identity) => !seenCodeOwners.has(identity))
  ].sort());
  const totals = Object.freeze({
    production_files: sortedPaths.length,
    sites: sites.length,
    catch_clauses: sites.filter((site) => site.site_kind === "catch_clause").length,
    code_literals: sites.filter((site) => site.site_kind === "code_literal").length,
    owned_wk2359: sites.filter((site) => site.owner?.semantic_owner === "WK-2359").length,
    owned_wk2382: sites.filter((site) => site.owner?.semantic_owner === "WK-2382").length,
    unresolved: sites.filter((site) => site.owner === null).length,
    multiply_classified: 0,
    owner_site_absent: ownerSiteAbsences.length
  });
  return Object.freeze({
    schema_version: "guarded-owner-exception-reconciliation.v1",
    totals,
    sites: Object.freeze(sites),
    owner_site_absences: ownerSiteAbsences,
    unresolved_facts: Object.freeze(sites.flatMap((site) => site.unresolved_fact ? [site.unresolved_fact] : []))
  });
}

export function createGuardedOwnerExceptionCategoryAdapters(codeLiterals) {
  if (!Array.isArray(codeLiterals) || codeLiterals.some((code) => typeof code !== "string")) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { location: "code_literals" });
  }
  return new Map([
    ["asynchronous_failure", defineGuardedOwnerCategoryAdapter("asynchronous_failure", async ({ path: sourcePath, source }) => {
      const found = await discoverGuardedCatchAndCodeSites({ path: sourcePath, source });
      return found.catches.map(({ line, column, kind }) => ({ line, column, kind }));
    })],
    ["public_refusal", defineGuardedOwnerCategoryAdapter("public_refusal", async ({ path: sourcePath, source }) => {
      const found = await discoverGuardedCatchAndCodeSites({ path: sourcePath, source, codeLiterals });
      return found.code_literals.map(({ line, column, kind }) => ({ line, column, kind }));
    })]
  ]);
}

export async function loadGuardedOwnerExceptionCodeLiterals({ read = readFile, refusalCorpusPath = DEFAULT_REFUSAL_CORPUS } = {}) {
  const corpus = await readJson(refusalCorpusPath, read);
  if (corpus.schema_version !== "refusal-emission-census.v1" || !Array.isArray(corpus.entries)) {
    fail(GUARDED_OWNER_EXCEPTION_DIAGNOSTICS.CORPUS_INVALID, { path: refusalCorpusPath });
  }
  return Object.freeze([...new Set(corpus.entries.map((entry) => entry.emitted_code))].sort());
}
