import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  openSync,
  unlinkSync,
  writeSync
} from "node:fs";
import path from "node:path";

import {
  resolveLauncherOwnedWorkspaceDurableStateRoot
} from "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";

export const WIKI_MCP_COMMON_PROOF_RESOLVER_FD = 5;
export const WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION =
  "launcher-common-proof-resolver-capability.v1";
export const WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_MAX_BYTES = 8192;

const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function serializeWikiMcpCommonProofResolverCapability(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join("\0") !== "repositoryAlias\0workspaceDir") {
    const error = new Error(
      "launcher common-proof resolver capability accepts only its fixed workspace binding"
    );
    error.code = "common_proof_resolver_capability_binding_failed";
    throw error;
  }
  const { workspaceDir, repositoryAlias } = input;
  const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
  if (resolved.ok !== true || typeof repositoryAlias !== "string" ||
      !ALIAS_RE.test(repositoryAlias)) {
    const error = new Error(
      "launcher could not resolve the common-proof workspace capability binding"
    );
    error.code = "common_proof_resolver_capability_binding_failed";
    throw error;
  }
  const bytes = `${JSON.stringify({
    schema_version: WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION,
    repository_alias: repositoryAlias,
    workspace_dir: resolved.workspace_root
  })}\n`;
  if (Buffer.byteLength(bytes, "utf8") >
      WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_MAX_BYTES) {
    const error = new Error("launcher common-proof resolver capability exceeds its bound");
    error.code = "common_proof_resolver_capability_over_bound";
    throw error;
  }
  return bytes;
}

export function openWikiMcpCommonProofResolverCapabilityDescriptor({
  directory,
  workspaceDir,
  repositoryAlias
}) {
  const bytes = serializeWikiMcpCommonProofResolverCapability({
    workspaceDir,
    repositoryAlias
  });
  const carrierPath = path.join(
    directory,
    `.launcher-common-proof-resolver-${randomBytes(16).toString("hex")}`
  );
  let writeFd = null;
  let readFd = null;
  try {
    writeFd = openSync(
      carrierPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    writeSync(writeFd, bytes);
    fsyncSync(writeFd);
    closeSync(writeFd);
    writeFd = null;
    readFd = openSync(carrierPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    unlinkSync(carrierPath);
    return readFd;
  } catch (error) {
    if (writeFd !== null) try { closeSync(writeFd); } catch {   }
    if (readFd !== null) try { closeSync(readFd); } catch {   }
    try { unlinkSync(carrierPath); } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        Object.defineProperty(error, "capabilityCleanupFailure", {
          value: cleanupError,
          enumerable: false
        });
      }
    }
    throw error;
  }
}
