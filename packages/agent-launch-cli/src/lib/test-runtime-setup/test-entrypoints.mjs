

import { readFileSync } from "node:fs";
import path from "node:path";

export const REPOSITORY_RUNTIME_CONFIG_FILE = "agent-chassis-runtime.json";

export const TEST_ENTRYPOINT_SHAPES = Object.freeze({
  "lib0-testing": Object.freeze({ fields: Object.freeze(["runner", "project", "target", "entrypoint"]),
    identity: Object.freeze(["runner", "project", "target"]) }),
  "node-test": Object.freeze({ fields: Object.freeze(["runner", "project", "adapter", "entrypoint"]),
    identity: Object.freeze(["runner", "project"]) })
});
export const TEST_ENTRYPOINT_ADAPTERS = Object.freeze(["node-test-wrapper"]);
const GLOB_CHARACTER = /[*?[\]{}]/u;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePathDefect(value, { file }) {
  if (typeof value !== "string") return "it is not a string";
  if (value.length === 0) return "it is empty";
  if (value.includes("\0")) return "it contains NUL";
  if (value.includes("\\")) return "it contains a backslash";
  if (value.startsWith("/")) return "it is absolute";
  if (/^[A-Za-z]:/u.test(value)) return "it names a drive";
  if (GLOB_CHARACTER.test(value)) return "it contains a glob character";
  if (value === ".") return file ? "it names the repository root, not a file" : null;
  for (const segment of value.split("/")) {
    if (segment === "") return "it has an empty segment";
    if (segment === "." || segment === "..") return `it has a ${segment} segment`;
  }
  return null;
}

export function parseTestEntrypoints(fail, value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("test_entrypoints must be a nonempty array of test-entrypoint associations");
  }
  const associations = [];
  const identities = new Set();
  for (const [index, entry] of value.entries()) {
    const label = `test_entrypoints[${index}]`;
    if (!isPlainObject(entry)) fail(`${label} must be an object`);
    const shape = typeof entry.runner === "string" && Object.hasOwn(TEST_ENTRYPOINT_SHAPES, entry.runner)
      ? TEST_ENTRYPOINT_SHAPES[entry.runner] : null;
    if (shape === null) {
      fail(`${label}.runner must be one of ${Object.keys(TEST_ENTRYPOINT_SHAPES).join(", ")}`);
    }
    for (const key of Object.keys(entry)) {
      if (!shape.fields.includes(key)) {
        fail(`${label} has unknown field ${key} (allowed: ${shape.fields.join(", ")})`);
      }
    }
    for (const field of shape.fields) {
      if (!Object.hasOwn(entry, field)) fail(`${label}.${field} is required`);
    }
    if (Object.hasOwn(entry, "adapter") && !TEST_ENTRYPOINT_ADAPTERS.includes(entry.adapter)) {
      fail(`${label}.adapter must be one of ${TEST_ENTRYPOINT_ADAPTERS.join(", ")}`);
    }
    for (const field of ["project", "target", "entrypoint"].filter((name) => shape.fields.includes(name))) {
      const defect = relativePathDefect(entry[field], { file: field !== "project" });
      if (defect !== null) {
        fail(`${label}.${field} must be a canonical repository-relative path: ${defect}`);
      }
    }
    const identity = JSON.stringify(shape.identity.map((field) => entry[field]));
    if (identities.has(identity)) {
      fail(`test_entrypoints associates ${shape.identity.map((field) => entry[field]).join(" ")} more than once`);
    }
    identities.add(identity);
    associations.push(Object.fromEntries(shape.fields.map((field) => [field, entry[field]])));
  }
  return associations;
}

export function serializeTestEntrypoints(associations) {
  return associations.map((entry) => Object.fromEntries(
    TEST_ENTRYPOINT_SHAPES[entry.runner].fields.map((field) => [field, entry[field]])));
}

export class SavedTestEntrypointsError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "SavedTestEntrypointsError";
    this.code = "test_runtime_test_entrypoints_invalid";
    this.detail = detail;
  }
}

export function readSavedTestEntrypoints(checkout) {
  const file = path.join(checkout, REPOSITORY_RUNTIME_CONFIG_FILE);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze([]);
    throw new SavedTestEntrypointsError(`${REPOSITORY_RUNTIME_CONFIG_FILE} is unreadable: ${error.code ?? error.message}`,
      { file: REPOSITORY_RUNTIME_CONFIG_FILE, errno: error?.code ?? null });
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new SavedTestEntrypointsError(`invalid runtime configuration ${REPOSITORY_RUNTIME_CONFIG_FILE}: ` +
      `not valid JSON (${error.message})`, { file: REPOSITORY_RUNTIME_CONFIG_FILE });
  }
  if (!isPlainObject(document) || !Object.hasOwn(document, "test_entrypoints")) return Object.freeze([]);
  const fail = (detail) => {
    throw new SavedTestEntrypointsError(`invalid runtime configuration ${REPOSITORY_RUNTIME_CONFIG_FILE}: ${detail}`,
      { file: REPOSITORY_RUNTIME_CONFIG_FILE });
  };
  return Object.freeze(parseTestEntrypoints(fail, document.test_entrypoints).map((entry) => Object.freeze(entry)));
}
