import path from "node:path";
import { loadManifest } from "../lib/contract.mjs";
import { nextId } from "../lib/wiki.mjs";

export async function allocateId({ dir = ".", type, repo = null }) {
  if (!type) {
    throw new Error("allocateId requires type");
  }

  const targetDir = path.resolve(String(dir));
  const manifest = await loadManifest();
  const id = await nextId(targetDir, type, manifest, { reserve: true });

  return {
    targetDir,
    type: String(type).toLowerCase(),
    id,
    qualifiedId: repo ? `${repo}:${id}` : id,
    reserved: true
  };
}
