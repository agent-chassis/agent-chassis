import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildTestProofFaultModuleSource,
  buildTestProofFaultModuleUrl,
  validateTestProofModuleFaultConfiguration
} from
  "./workspace-agent-test-proof-module-fault-contract.mjs";

const url = new URL(import.meta.url);
const encoded = url.searchParams.get("configuration");
if (encoded === null) throw new Error("launcher module-fault loader configuration is required");

let configuration;
try {
  configuration = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
} catch (error) {
  throw new Error("launcher module-fault loader configuration is invalid", { cause: error });
}

validateTestProofModuleFaultConfiguration(configuration);

const targetUrl = pathToFileURL(path.resolve(process.cwd(), configuration.module_path)).href;
const faultUrl = buildTestProofFaultModuleUrl(configuration);
let exportNames = null;

function substituteFaultModule() {
  return { url: faultUrl, shortCircuit: true };
}

export function initialize(data) {

  exportNames = Array.isArray(data?.export_names) ? [...data.export_names] : null;
}

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  return resolved.url === targetUrl
    ? substituteFaultModule()
    : resolved;
}

export async function load(moduleUrl, context, nextLoad) {
  if (moduleUrl !== faultUrl) return nextLoad(moduleUrl, context);
  return {
    format: "module",
    shortCircuit: true,
    source: buildTestProofFaultModuleSource(configuration, exportNames)
  };
}
