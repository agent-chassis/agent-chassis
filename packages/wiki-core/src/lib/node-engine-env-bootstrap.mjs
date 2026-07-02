

import path from "node:path";
import { readFileSync, statSync } from "node:fs";

import {
  SERVICE_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  REQUEST_CONTRACT_DIGEST_ENV_KEYS,
  WORKER_ADMISSION_ROUTE_ENV_KEYS,
  WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS
} from "./node-engine-api-client.mjs";

export const NODE_ENGINE_API_SMOKE_ENV_KEYS = Object.freeze([
  "NODE_ENGINE_API_SMOKE",
  "NODE_ENGINE_API_SMOKE_TIMEOUT_MS"
]);

export const NODE_ENGINE_BOOTSTRAP_ENV_KEYS = Object.freeze(
  [
    ...SERVICE_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...WORKER_ADMISSION_ROUTE_ENV_KEYS,
    ...REQUEST_CONTRACT_DIGEST_ENV_KEYS,
    ...WORKER_ADMISSION_AUTHORITY_BINDING_ENV_KEYS,
    ...NODE_ENGINE_API_SMOKE_ENV_KEYS
  ].filter((key, index, all) => all.indexOf(key) === index)
);

const ENV_KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotEnvText(text) {
  const values = new Map();
  const malformedLines = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      malformedLines.push(i + 1);
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (!ENV_KEY_NAME_PATTERN.test(key)) {
      malformedLines.push(i + 1);
      continue;
    }
    let value = body.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return { values, malformedLines };
}

export function resolveNodeEngineEnvFilePath(dir) {
  const dirPath = typeof dir === "string" ? dir.trim() : "";
  if (dirPath === "" || !path.isAbsolute(dirPath)) return null;
  const envFilePath = path.join(dirPath, ".env");
  try {
    return statSync(envFilePath).isFile() ? envFilePath : null;
  } catch {
    return null;
  }
}

export function readNonSecretWorkspaceEnvValue({
  dir,
  key,
  readFileText = (filePath) => readFileSync(filePath, "utf8")
} = {}) {
  if (typeof key !== "string" || !ENV_KEY_NAME_PATTERN.test(key)) {
    return null;
  }
  const envFilePath = resolveNodeEngineEnvFilePath(typeof dir === "string" ? dir : "");
  if (!envFilePath) {
    return null;
  }
  let text;
  try {
    text = readFileText(envFilePath);
  } catch {
    return null;
  }
  const { values } = parseDotEnvText(text);
  if (!values.has(key)) {
    return null;
  }
  const value = values.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function bootstrapNodeEngineEnvFromFile({
  env,
  envFilePath,
  readFileText = (filePath) => readFileSync(filePath, "utf8")
} = {}) {
  const base = {
    loaded: false,
    env_file_present: false,
    applied_keys: Object.freeze([]),
    skipped_existing_keys: Object.freeze([]),
    ignored_malformed_line_count: 0
  };

  if (!env || typeof env !== "object" || !envFilePath) {
    return Object.freeze({ ...base });
  }

  let text;
  try {
    text = readFileText(envFilePath);
  } catch {

    return Object.freeze({ ...base, env_file_present: true });
  }

  const { values, malformedLines } = parseDotEnvText(text);
  const appliedKeys = [];
  const skippedExistingKeys = [];
  for (const key of NODE_ENGINE_BOOTSTRAP_ENV_KEYS) {
    if (!values.has(key)) continue;
    const incoming = values.get(key);
    if (typeof incoming !== "string" || incoming.trim() === "") continue;
    const existing = env[key];
    if (typeof existing === "string" && existing.trim() !== "") {

      skippedExistingKeys.push(key);
      continue;
    }
    env[key] = incoming;
    appliedKeys.push(key);
  }

  return Object.freeze({
    loaded: appliedKeys.length > 0,
    env_file_present: true,
    applied_keys: Object.freeze(appliedKeys),
    skipped_existing_keys: Object.freeze(skippedExistingKeys),
    ignored_malformed_line_count: malformedLines.length
  });
}
