#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION,
  buildAdvisoryVocabularyView,
  describeVocabularyTerms,
  searchVocabulary
} from "../../../lib/vocabulary-v034.mjs";

const TOOL_VERSION = "controlled-vocabulary-query.experimental.v0.1";
const VALID_KINDS = new Set([
  "operator", "type_term", "applicability_mode", "value_kind"
]);

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/query-vocabulary.mjs --term <term> [--term <term> ...]
  node packages/controlled-contract/bin/query-vocabulary.mjs --search <text> [--kind <kind> ...]
  node packages/controlled-contract/bin/query-vocabulary.mjs --view \\
    [--operator <term> ...] [--type <term> ...] [--applicability <mode> ...]

Modes are mutually exclusive. Exact term lookup distinguishes active, withheld,
and unknown terms. Search returns matching definitions. A view is an advisory,
digest-bound subset with explicit omission counts. None is validation or policy
authority.`;
}

function parseArgs(argv) {
  const options = {
    terms: [],
    search: null,
    kinds: [],
    view: false,
    operators: [],
    types: [],
    applicabilityModes: [],
    help: false
  };
  const next = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--view") {
      options.view = true;
      continue;
    }
    const destinations = {
      "--term": "terms",
      "--kind": "kinds",
      "--operator": "operators",
      "--type": "types",
      "--applicability": "applicabilityModes"
    };
    if (flag === "--search") options.search = next(index, flag);
    else if (destinations[flag]) options[destinations[flag]].push(next(index, flag));
    else throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  if (options.help) return options;
  const modes = [options.terms.length > 0, options.search !== null, options.view]
    .filter(Boolean).length;
  if (modes !== 1) throw new Error("select exactly one of --term, --search, or --view");
  if (!options.view && [
    ...options.operators, ...options.types, ...options.applicabilityModes
  ].length > 0) throw new Error("view selections require --view");
  if (options.search === null && options.kinds.length > 0) {
    throw new Error("--kind requires --search");
  }
  for (const kind of options.kinds) {
    if (!VALID_KINDS.has(kind)) throw new Error(`unknown vocabulary kind: ${kind}`);
  }
  return options;
}

function queryVocabulary(options) {
  let result;
  if (options.terms.length > 0) {
    result = {
      query_kind: "exact_terms",
      vocabulary_version: VOCABULARY_VERSION,
      vocabulary_digests: { ...VOCABULARY_DIGESTS },
      results: describeVocabularyTerms(options.terms)
    };
  } else if (options.search !== null) {
    result = {
      query_kind: "search",
      ...searchVocabulary({
        text: options.search,
        ...(options.kinds.length > 0 ? { kinds: options.kinds } : {})
      })
    };
  } else {
    result = {
      query_kind: "advisory_view",
      ...buildAdvisoryVocabularyView({
        operator_terms: options.operators,
        type_terms: options.types,
        applicability_modes: options.applicabilityModes
      })
    };
  }
  return {
    tool_version: TOOL_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    ...result
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = queryVocabulary(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { TOOL_VERSION, main, parseArgs, queryVocabulary, usage };
