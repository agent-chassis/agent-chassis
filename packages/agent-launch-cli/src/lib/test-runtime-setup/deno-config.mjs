

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DENO_CONFIG_FILES = Object.freeze(["deno.json", "deno.jsonc"]);
export const DENO_LOCK_FILE = "deno.lock";

export function denoConfigName(projectDir) {
  return DENO_CONFIG_FILES.find((name) => existsSync(path.join(projectDir, name)));
}

function parseJsonc(text) {
  let json = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"") {
      let end = index + 1;
      while (end < text.length && text[end] !== "\"") end += text[end] === "\\" ? 2 : 1;
      json += text.slice(index, end + 1);
      index = end;
    } else if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      json += "\n";
    } else if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 1;
      json += " ";
    } else {
      json += character;
    }
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/gu, "$1"));
}

export function denoLockSelection(projectDir) {
  const selected = (name) => {
    const file = path.resolve(projectDir, name);
    return { disabled: false, name: path.relative(projectDir, file).split(path.sep).join("/"), file };
  };
  const config = denoConfigName(projectDir);
  if (config === undefined) return selected(DENO_LOCK_FILE);
  let lock;
  try {
    lock = parseJsonc(readFileSync(path.join(projectDir, config), "utf8"))?.lock;
  } catch {
    return selected(DENO_LOCK_FILE);
  }
  if (lock === false) return { disabled: true };
  const named = typeof lock === "string" ? lock
    : lock !== null && typeof lock === "object" && typeof lock.path === "string" ? lock.path : "";
  return selected(named === "" ? DENO_LOCK_FILE : named);
}
