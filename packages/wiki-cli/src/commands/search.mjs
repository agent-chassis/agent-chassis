import path from "node:path";
import { searchRepo } from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

export async function runSearch(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki search --query <text> [--dir <path>] [--limit <n>] [--reindex] [--profile <standard|research>] [--extensions a,b,c] [--kind docs|issues|decisions|initiatives|sources|areas|wiki|<extension>] [--retrieval-role <entrypoint|hub|inventory|record>] [--canonicality <canonical|noncanonical>] [--maintenance-mode <curated|generated|operational>] [--knowledge-role <evidence|synthesis|decision|work|reference>] [--evidence-stage <primary|derived>] [--retrieval-visibility <default|support|suppressed>] [--lifecycle <active|stable|historical>] [--sensitivity <normal|restricted>] [--topic <value>] [--type <type>] [--status <status>] [--priority <priority>] [--owner <owner>] [--area <area>] [--initiative <id>]"
    );
    return;
  }

  const query = optionalOption(options, "query");
  if (!query) {
    throw new Error("search requires --query");
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await searchRepo({
    dir: targetDir,
    query,
    limit: optionalOption(options, "limit"),
    reindex: Boolean(options.reindex),
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions"),
    kind: optionalOption(options, "kind"),
    retrieval_role: optionalOption(options, "retrieval-role"),
    canonicality: optionalOption(options, "canonicality"),
    maintenance_mode: optionalOption(options, "maintenance-mode"),
    knowledge_role: optionalOption(options, "knowledge-role"),
    evidence_stage: optionalOption(options, "evidence-stage"),
    retrieval_visibility: optionalOption(options, "retrieval-visibility"),
    lifecycle: optionalOption(options, "lifecycle"),
    sensitivity: optionalOption(options, "sensitivity"),
    topic: optionalOption(options, "topic"),
    type: optionalOption(options, "type"),
    status: optionalOption(options, "status"),
    priority: optionalOption(options, "priority"),
    owner: optionalOption(options, "owner"),
    area: optionalOption(options, "area"),
    initiative: optionalOption(options, "initiative")
  });

  if (result.results.length === 0) {
    console.log(`No results for "${result.query}".`);
    return;
  }

  console.log(`Search results for "${result.query}" (${result.results.length} shown, mode: ${result.mode})`);
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
}
