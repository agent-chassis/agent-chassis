import path from "node:path";
import { searchRepo } from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

const FILTER_OPTIONS = [
  ["kind", "kind"],
  ["retrieval-role", "retrieval_role"],
  ["canonicality", "canonicality"],
  ["maintenance-mode", "maintenance_mode"],
  ["knowledge-role", "knowledge_role"],
  ["evidence-stage", "evidence_stage"],
  ["retrieval-visibility", "retrieval_visibility"],
  ["lifecycle", "lifecycle"],
  ["sensitivity", "sensitivity"],
  ["topic", "topic"],
  ["type", "type"],
  ["status", "status"],
  ["priority", "priority"],
  ["owner", "owner"],
  ["area", "area"],
  ["initiative", "initiative"]
];

const POPULATION_OPTIONS = [
  "query",
  "limit",
  "profile",
  "extensions",
  "history",
  ...FILTER_OPTIONS.map(([option]) => option)
];

function searchRequest(options, targetDir) {
  if ("continuation" in options) {
    const continuation = optionalOption(options, "continuation");
    if (!continuation) {
      throw new Error("search --continuation requires the token returned by a previous search");
    }
    const replacements = POPULATION_OPTIONS.filter((option) => option in options);
    if (replacements.length > 0) {
      throw new Error(
        `search --continuation cannot be combined with ${replacements.map((option) => `--${option}`).join(", ")}`
      );
    }
    return { dir: targetDir, continuation };
  }

  const query = optionalOption(options, "query");
  if (!query) {
    throw new Error("search requires --query");
  }
  if ("history" in options && options.history !== true) {
    throw new Error("search --history is a flag and does not take a value");
  }

  return {
    dir: targetDir,
    query,
    limit: optionalOption(options, "limit"),
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions"),
    ...(options.history === true ? { history: true } : {}),
    ...Object.fromEntries(FILTER_OPTIONS.map(([option, field]) => [field, optionalOption(options, option)]))
  };
}

export async function runSearch(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki search (--query <text> [--limit <1..50>] [--profile <standard|research>] [--extensions a,b,c] [--kind docs|issues|decisions|initiatives|sources|areas|wiki|<extension>] [--retrieval-role <entrypoint|hub|inventory|record>] [--canonicality <canonical|noncanonical>] [--maintenance-mode <curated|generated|operational>] [--knowledge-role <evidence|synthesis|decision|work|reference>] [--evidence-stage <primary|derived>] [--retrieval-visibility <default|support|suppressed>] [--lifecycle <active|stable|historical>] [--sensitivity <normal|restricted>] [--topic <value>] [--type <type>] [--status <status>] [--priority <priority>] [--owner <owner>] [--area <area>] [--initiative <id>] | --continuation <token>) [--dir <path>]\n\n" +
        "Entry history search needs a registered repository identity and is available through the repository-bound workspace_search_repo route."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await searchRepo(searchRequest(options, targetDir));

  if (result.results.length === 0) {
    console.log(`No results for "${result.query}".`);
    return;
  }

  console.log(`Search results for "${result.query}" (${result.results.length} of ${result.total_count})`);
  for (const item of result.results) {
    const metadata = Object.entries(item.metadata)
      .filter(([key]) => key !== "id")
      .map(([key, value]) =>
        Array.isArray(value) ? `${key}: ${value.join(", ")}` : `${key}: ${value}`
      )
      .join(", ");
    console.log(
      `- ${item.relativePath}${item.id ? ` [${item.id}]` : ""} :: ${item.title}${item.heading ? ` / ${item.heading}` : ""}${metadata ? ` :: ${metadata}` : ""}`
    );
  }

  const continuation = result.next_calls[0]?.arguments?.continuation;
  if (continuation) {
    console.log(`Continuation: ${continuation}`);
  }
}
