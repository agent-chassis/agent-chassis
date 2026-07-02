import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT_DIR = path.resolve(THIS_DIR, "../../contract");
const TEMPLATE_DIR = path.join(CONTRACT_DIR, "templates");

export function getContractDir() {
  return CONTRACT_DIR;
}

export function getTemplateDir() {
  return TEMPLATE_DIR;
}

export async function loadManifest() {
  const manifestPath = path.join(CONTRACT_DIR, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

export async function readContractFile(relativePath) {
  return readFile(path.join(CONTRACT_DIR, relativePath), "utf8");
}

