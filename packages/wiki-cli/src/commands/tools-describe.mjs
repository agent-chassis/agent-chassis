import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createToolDiscoveryEnvelope, loadToolDiscoveryDescriptor } from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import { optionalOption, parseArgs } from "../lib/cli.mjs";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WIKI_CLI_PACKAGE_JSON_PATH = path.resolve(THIS_DIR, "../../package.json");
const VERSION_FALLBACK = "0.0.0";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function readPackageVersionByPath(packageJsonPath) {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : VERSION_FALLBACK;
  } catch {
    return VERSION_FALLBACK;
  }
}

async function resolveDependencyVersion(packageJsonSpecifier) {
  try {
    return await readPackageVersionByPath(require.resolve(packageJsonSpecifier));
  } catch {
    return VERSION_FALLBACK;
  }
}

async function loadToolDiscoveryPackageVersions() {
  const [wiki_core, wiki_cli] = await Promise.all([
    resolveDependencyVersion("@agent-chassis/wiki-core/package.json"),
    readPackageVersionByPath(WIKI_CLI_PACKAGE_JSON_PATH)
  ]);
  return { wiki_core, wiki_cli };
}

function resolveToolDiscoveryQuery(options) {
  const taskId = optionalOption(options, "task");
  const toolName = optionalOption(options, "tool");

  if (taskId && toolName) {
    throw new Error("Use only one of --task or --tool");
  }

  if (taskId) {
    return { task_id: taskId };
  }

  if (toolName) {
    return { tool_name: toolName };
  }

  return {};
}

function formatToolDiscoveryEnvelope(envelope) {
  const lines = [
    `Tool discovery (${envelope.interface}, ${envelope.source_kind})`,
    `Schema: ${envelope.schema_version}`,
    `Descriptor: ${envelope.descriptor.path}`,
    `Digest: ${envelope.descriptor.digest}`,
    `Freshness: ${envelope.freshness.state}${envelope.freshness.degraded ? " (degraded)" : ""}`
  ];

  if (Object.keys(envelope.package_versions || {}).length > 0) {
    lines.push(
      `Package versions: ${Object.entries(envelope.package_versions)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`
    );
  }

  if (envelope.query) {
    lines.push(`Query: ${JSON.stringify(envelope.query)}`);
  }

  lines.push(`Results: ${envelope.results.length}`);
  for (const result of envelope.results) {
    lines.push(
      `- [${result.rank}] ${result.tool_name} :: ${result.display_name} :: ${result.entrypoint}`
    );
  }

  if (envelope.diagnostics.length > 0) {
    lines.push("Diagnostics:");
    for (const diagnostic of envelope.diagnostics) {
      lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

export async function runToolsDescribe(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki tools-describe [--task <task_id>|--tool <tool_name>] [--json]\n" +
        "Describes the installed tooling's own discovery surface. --dir is accepted " +
        "for compatibility but does not change which catalog is described."
    );
    return;
  }

  const descriptor = await loadToolDiscoveryDescriptor();
  const package_versions = await loadToolDiscoveryPackageVersions();
  const query = resolveToolDiscoveryQuery(options);
  const envelope = createToolDiscoveryEnvelope({
    interface: "cli",
    source_kind: "checked_in_descriptor",
    package_versions,
    descriptor,
    query
  });

  if (options.json) {
    printJson(envelope);
    return;
  }

  console.log(formatToolDiscoveryEnvelope(envelope));
}
