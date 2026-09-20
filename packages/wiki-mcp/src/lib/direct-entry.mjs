

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NON_ENTRY_REALPATH_ERROR_CODES = Object.freeze([
  "ELOOP",
  "ENAMETOOLONG",
  "ENOENT",
  "ENOTDIR"
]);

const NON_ENTRY_CODES = new Set(NON_ENTRY_REALPATH_ERROR_CODES);

export function isDirectModuleEntry(moduleUrl, {
  argv1 = process.argv[1],
  realpath = realpathSync
} = {}) {
  if (typeof moduleUrl !== "string" || moduleUrl.length === 0) {
    throw new TypeError("isDirectModuleEntry requires the module's import.meta.url");
  }
  if (typeof argv1 !== "string" || argv1.length === 0) return false;

  const here = fileURLToPath(moduleUrl);
  const resolved = path.resolve(argv1);
  if (resolved === here) return true;

  let canonical;
  try {
    canonical = realpath(resolved);
  } catch (error) {
    if (error && NON_ENTRY_CODES.has(error.code)) return false;
    throw error;
  }
  return canonical === here;
}
