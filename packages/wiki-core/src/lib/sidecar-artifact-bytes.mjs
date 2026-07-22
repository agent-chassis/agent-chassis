import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function parseSidecarArtifactBytes(rawBytes) {
  if (!Buffer.isBuffer(rawBytes)) {
    throw new TypeError("sidecar artifact bytes must be a Buffer");
  }
  return JSON.parse(FATAL_UTF8_DECODER.decode(rawBytes));
}

export async function readSidecarArtifactBytes(artifactPath) {
  const rawBytes = await readFile(artifactPath);
  return {
    rawBytes,
    artifact: parseSidecarArtifactBytes(rawBytes)
  };
}
