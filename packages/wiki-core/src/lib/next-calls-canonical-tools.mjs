

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DISCOVERY_DIR = path.join(THIS_DIR, "../../data/tool-discovery");
const TOOL_DISCOVERY_MANIFEST = path.join(TOOL_DISCOVERY_DIR, "manifest.json");

const CANONICAL_NEXT_CALL_TOOL_KIND = "mcp_tool";

const READ_ONLY_SIDE_EFFECT = "read_only";

function canonicalSideEffects(entry, file) {
  const declared = entry.side_effects;
  if (!Array.isArray(declared) || declared.length === 0 ||
      declared.some((effect) => typeof effect !== "string" || effect.length === 0) ||
      new Set(declared).size !== declared.length) {
    throw new Error(
      `next-calls canonical corpus: fragment ${file} declares no exact side_effects for ${entry.tool_name}`
    );
  }

  if (declared.includes(READ_ONLY_SIDE_EFFECT) && declared.length !== 1) {
    throw new Error(
      `next-calls canonical corpus: fragment ${file} combines read_only with other side_effects for ${entry.tool_name}`
    );
  }
  return Object.freeze([...declared]);
}

function loadCanonicalNextCallTools() {
  const manifest = JSON.parse(readFileSync(TOOL_DISCOVERY_MANIFEST, "utf8"));
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    throw new Error(
      "next-calls canonical corpus: tool-discovery manifest declares no fragments"
    );
  }
  const sideEffectsByTool = new Map();
  const seen = new Set();
  for (const fragment of manifest.fragments) {
    const file = fragment?.file;
    if (typeof file !== "string" || file.length === 0) {
      throw new Error("next-calls canonical corpus: fragment entry declares no file");
    }
    const parsed = JSON.parse(readFileSync(path.join(TOOL_DISCOVERY_DIR, file), "utf8"));
    if (!Array.isArray(parsed.tools)) {
      throw new Error(`next-calls canonical corpus: fragment ${file} declares no tools array`);
    }
    for (const entry of parsed.tools) {
      const toolName = entry?.tool_name;
      if (typeof toolName !== "string" || toolName.length === 0) {
        throw new Error(`next-calls canonical corpus: fragment ${file} declares a nameless tool`);
      }

      if (seen.has(toolName)) {
        throw new Error(
          `next-calls canonical corpus: duplicate tool_name ${toolName} in fragment ${file}`
        );
      }
      seen.add(toolName);
      if (entry.kind === CANONICAL_NEXT_CALL_TOOL_KIND) {
        sideEffectsByTool.set(toolName, canonicalSideEffects(entry, file));
      }
    }
  }
  if (sideEffectsByTool.size === 0) {
    throw new Error("next-calls canonical corpus: assembled corpus names no MCP tools");
  }
  return {
    names: Object.freeze(new Set(sideEffectsByTool.keys())),
    sideEffectsByTool
  };
}

const CANONICAL_CORPUS = loadCanonicalNextCallTools();

export const CANONICAL_NEXT_CALL_TOOL_NAMES = CANONICAL_CORPUS.names;

export function isCanonicalNextCallTool(tool) {
  return typeof tool === "string" && CANONICAL_NEXT_CALL_TOOL_NAMES.has(tool);
}

export function canonicalToolSideEffects(tool) {
  if (!isCanonicalNextCallTool(tool)) return null;
  return CANONICAL_CORPUS.sideEffectsByTool.get(tool);
}

export function isCanonicalReadOnlyTool(tool) {
  const effects = canonicalToolSideEffects(tool);
  return effects !== null && effects.length === 1 && effects[0] === READ_ONLY_SIDE_EFFECT;
}
