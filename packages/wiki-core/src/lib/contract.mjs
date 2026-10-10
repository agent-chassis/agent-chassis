import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT_DIR = path.resolve(THIS_DIR, "../../contract");
const TEMPLATE_DIR = path.join(CONTRACT_DIR, "templates");
const MANIFEST_PATH = path.join(CONTRACT_DIR, "manifest.json");
let manifestRecordTypeVocabulary = null;
let manifestBirthKinds = null;
export const CONTRACT_MANIFEST_READ_FIELDS = Object.freeze(["manifest"]);

export function getContractDir() {
  return CONTRACT_DIR;
}

export function getTemplateDir() {
  return TEMPLATE_DIR;
}

export async function loadManifest() {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
}

export function getManifestRecordTypeVocabulary() {
  if (manifestRecordTypeVocabulary === null) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const canonical = Object.keys(manifest.types ?? {});
    const aliases = [...new Set(canonical.flatMap(
      (kind) => Array.isArray(manifest.types[kind]?.aliases)
        ? manifest.types[kind].aliases
        : []
    ))].filter((alias) => !canonical.includes(alias));
    manifestRecordTypeVocabulary = Object.freeze({
      canonical: Object.freeze(canonical),
      aliases: Object.freeze(aliases),
      accepted: Object.freeze([...new Set([...canonical, ...aliases])])
    });
  }
  return {
    canonical: [...manifestRecordTypeVocabulary.canonical],
    aliases: [...manifestRecordTypeVocabulary.aliases],
    accepted: [...manifestRecordTypeVocabulary.accepted]
  };
}

export async function readContractFile(relativePath) {
  return readFile(path.join(CONTRACT_DIR, relativePath), "utf8");
}

export function getManifestRecordBirthKinds() {
  if (manifestBirthKinds === null) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const seen = new Set();
    manifestBirthKinds = Object.entries(manifest.types).map(([type, definition]) => {
      const kind = definition.publicKind;
      if (typeof kind !== "string" || kind.trim() === "" || seen.has(kind)) {
        throw new TypeError(`Invalid manifest publicKind for ${type}`);
      }
      seen.add(kind);
      return { kind, type };
    });
  }
  return structuredClone(manifestBirthKinds);
}
