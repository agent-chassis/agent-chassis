import { getAgentFaq } from "@agent-chassis/wiki-core";
import { optionalOption, parseArgs } from "../lib/cli.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function formatRoutes(routes, indent) {
  return routes.map((route) => `${indent}-> ${route.tool}${route.note ? ` :: ${route.note}` : ""}`);
}

function formatEntry(entry) {
  const lines = [
    `# ${entry.id} [${entry.actor}]`,
    `  ${entry.title}`,
    `  symptom: ${entry.symptom}`,
    `  cause: ${entry.cause}`
  ];
  if (Array.isArray(entry.routes) && entry.routes.length > 0) {
    lines.push("  routes:");
    lines.push(...formatRoutes(entry.routes, "    "));
  }
  if (Array.isArray(entry.fork) && entry.fork.length > 0) {
    lines.push("  fork:");
    for (const branch of entry.fork) {
      lines.push(`    when ${branch.when} [${branch.actor}]`);
      lines.push(...formatRoutes(branch.routes, "      "));
    }
  }
  if (Array.isArray(entry.related_codes) && entry.related_codes.length > 0) {
    lines.push(`  related_codes: ${entry.related_codes.join(", ")}`);
  }
  return lines.join("\n");
}

function formatResult(result) {
  const header = `Agent FAQ: ${result.entry_count}/${result.total_entry_count} entr${
    result.entry_count === 1 ? "y" : "ies"
  }`;
  if (result.entries.length === 0) {
    return `${header}\n(no entries match the query)`;
  }
  return [header, "", ...result.entries.map(formatEntry)].join("\n");
}

export async function runAgentFaq(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki agent-faq [--id <entry-id>] [--related-code <code>] [--json]\n" +
        "Serve the read-only agent-faq.v1 known-issues corpus (parity with the\n" +
        "workspace_agent_faq MCP tool). Each entry pairs a recurring symptom with the\n" +
        "exact structured route(s) to resolve it and the responsible actor."
    );
    return;
  }

  const result = getAgentFaq({
    id: optionalOption(options, "id"),
    related_code: optionalOption(options, "related-code")
  });

  if (options.json) {
    printJson(result);
  } else {
    console.log(formatResult(result));
  }
}
