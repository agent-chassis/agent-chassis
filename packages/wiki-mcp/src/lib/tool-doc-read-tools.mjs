

import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  loadToolDiscoveryDescriptor,
  projectRuntimeToolDocumentationReferences,
  rankToolDiscoveryTools,
  TOOL_DOC_REFERENCE_SCOPE_PACKAGE
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";

export const WORKSPACE_READ_TOOL_DOC_TOOL_NAME = "workspace_read_tool_doc";
export const PUBLIC_DOCS_MANIFEST_SCHEMA_VERSION = "public-docs-manifest.v1";

export const TOOL_DOC_READ_DIAGNOSTIC_CODES = Object.freeze({
  CARRIER_UNAVAILABLE: "package_docs_carrier_unavailable",
  MANIFEST_UNREADABLE: "package_docs_manifest_unreadable",
  MANIFEST_SCHEMA_MISMATCH: "package_docs_manifest_schema_mismatch",
  PACKAGE_VERSION_MISMATCH: "package_docs_package_version_mismatch",
  HIDDEN_TOOL: "tool_not_visible_to_session",
  UNADVERTISED_REFERENCE: "documentation_reference_not_advertised",
  MANIFEST_DISAGREEMENT: "descriptor_manifest_disagreement",
  INVALID_PATH: "invalid_documentation_path",
  PATH_CONTAINMENT: "documentation_path_containment_failure",
  READ_FAILED: "documentation_read_failed"
});

function toolDocReadRefusal(code, message, extra = {}) {
  const error = new Error(message);
  error.name = "ToolDocReadError";
  error.code = code;
  error.envelope = {
    schema_version: "tool-doc-read-refusal.v1",
    ok: false,
    tool: WORKSPACE_READ_TOOL_DOC_TOOL_NAME,
    code,
    message,
    ...extra
  };
  return error;
}

export function isSafeLogicalDocPath(value) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    return false;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export async function bindPackageDocsCarrier(carrier) {
  if (!carrier || typeof carrier !== "object") {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      message: "this session was not launched with a package documentation carrier"
    };
  }
  const { packageName, packageVersion, packageRoot, docsRoot, manifestPath } = carrier;
  if (
    typeof packageName !== "string" ||
    typeof packageVersion !== "string" ||
    typeof packageRoot !== "string" ||
    typeof docsRoot !== "string" ||
    typeof manifestPath !== "string" ||
    !path.isAbsolute(packageRoot) ||
    !path.isAbsolute(docsRoot) ||
    !path.isAbsolute(manifestPath)
  ) {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      message: "the supplied package documentation carrier is incomplete"
    };
  }

  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedDocsRoot = path.resolve(docsRoot);
  if (!resolvedDocsRoot.startsWith(`${resolvedPackageRoot}${path.sep}`)) {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
      message: "the supplied package documentation carrier is incomplete"
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_UNREADABLE,
      message: "the carrying package's documentation manifest is absent or unreadable"
    };
  }
  if (manifest?.schema_version !== PUBLIC_DOCS_MANIFEST_SCHEMA_VERSION) {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_SCHEMA_MISMATCH,
      message: "the carrying package's documentation manifest has an unsupported schema version"
    };
  }
  if (manifest?.package?.name !== packageName || manifest?.package?.version !== packageVersion) {
    return {
      bound: false,
      code: TOOL_DOC_READ_DIAGNOSTIC_CODES.PACKAGE_VERSION_MISMATCH,
      message:
        "the carrying package's documentation manifest names a different package identity or version"
    };
  }

  const entries = new Map();
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (
      entry?.available !== true ||
      !isSafeLogicalDocPath(entry?.logical_path) ||
      !isSafeLogicalDocPath(entry?.bundle_path)
    ) {
      continue;
    }
    entries.set(entry.logical_path, {
      logicalPath: entry.logical_path,
      bundlePath: entry.bundle_path,
      sha256: typeof entry.sha256 === "string" ? entry.sha256 : null,
      bytes: Number.isInteger(entry.bytes) ? entry.bytes : null
    });
  }

  return {
    bound: true,
    packageName,
    packageVersion,
    packageRoot: resolvedPackageRoot,
    docsRoot: resolvedDocsRoot,
    entries,
    servesLogicalPath(logicalPath) {
      return entries.has(logicalPath);
    }
  };
}

export function toDocumentationProjectionCarrier(boundCarrier) {
  return boundCarrier?.bound === true ? boundCarrier : null;
}

export function registerToolDocReadTools({
  registerTool,
  z,
  jsonContent,
  errorContent,
  docsCarrier = null,
  sessionRole = null,
  registeredTier = null,
  augmentDescriptor = (descriptor) => descriptor,
  loadDescriptor = loadToolDiscoveryDescriptor
}) {
  function resolveSessionRole() {
    if (typeof sessionRole === "string" && sessionRole !== "") {
      return sessionRole;
    }
    try {
      return parseToolProfile();
    } catch {
      return null;
    }
  }

  async function resolveVisibleToolProjection(toolName) {
    const role = resolveSessionRole();
    if (!shouldExposeTool(role, toolName)) {
      throw toolDocReadRefusal(
        TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL,
        "no such visible tool in this session"
      );
    }
    const descriptor = augmentDescriptor(await loadDescriptor());
    const query = { tool_name: toolName };
    const tierQuery =
      typeof registeredTier === "string" && registeredTier
        ? { ...query, registered_tier: registeredTier }
        : query;
    const [row] = rankToolDiscoveryTools(descriptor, tierQuery, { verbose: true });
    if (!row) {
      throw toolDocReadRefusal(
        TOOL_DOC_READ_DIAGNOSTIC_CODES.HIDDEN_TOOL,
        "no such visible tool in this session"
      );
    }
    return projectRuntimeToolDocumentationReferences(row, {
      docsCarrier: toDocumentationProjectionCarrier(docsCarrier)
    });
  }

  registerTool(
    WORKSPACE_READ_TOOL_DOC_TOOL_NAME,
    {
      description:
        "Read-only: return the bytes of one package-owned documentation reference that this session currently " +
        "advertises for one tool it can currently see. Pass `tool_name` (a tool visible in this session's " +
        "workspace_tools_describe/query output) and `path` (one of that tool's advertised package-scoped " +
        "`doc_references` logical paths). The route reapplies the session's role and tier visibility gate, requires " +
        "the selected descriptor and the bound package documentation manifest to agree, and reads only the " +
        "manifest-contained bundled file. Hidden tool names, unadvertised paths, absolute paths, traversal, an " +
        "absent or mismatched documentation carrier, and a package-version mismatch all refuse with a stable typed " +
        "diagnostic; the route never browses the package, never falls back to the consuming workspace, and never " +
        "discloses installation roots. Workspace-owned references keep using workspace_read_page.",
      inputSchema: z
        .object({
          tool_name: z.string(),
          path: z.string()
        })
        .strict()
    },
    async (args) => {
      try {

        if (!isSafeLogicalDocPath(args.path)) {
          throw toolDocReadRefusal(
            TOOL_DOC_READ_DIAGNOSTIC_CODES.INVALID_PATH,
            "path must be one advertised repository-relative logical documentation path"
          );
        }

        const projected = await resolveVisibleToolProjection(args.tool_name);

        if (docsCarrier?.bound !== true) {
          throw toolDocReadRefusal(
            docsCarrier?.code ?? TOOL_DOC_READ_DIAGNOSTIC_CODES.CARRIER_UNAVAILABLE,
            docsCarrier?.message ?? "this session serves no package documentation"
          );
        }
        const reference = (projected.doc_references ?? []).find(
          (entry) => entry.path === args.path
        );
        if (!reference || reference.scope !== TOOL_DOC_REFERENCE_SCOPE_PACKAGE) {
          throw toolDocReadRefusal(
            TOOL_DOC_READ_DIAGNOSTIC_CODES.UNADVERTISED_REFERENCE,
            "this tool does not currently advertise that package-scoped documentation reference",
            {
              tool_name: args.tool_name,
              advertised_paths: (projected.doc_references ?? [])
                .filter((entry) => entry.scope === TOOL_DOC_REFERENCE_SCOPE_PACKAGE)
                .map((entry) => entry.path)
            }
          );
        }
        const entry = docsCarrier.entries.get(args.path);
        if (!entry) {

          throw toolDocReadRefusal(
            TOOL_DOC_READ_DIAGNOSTIC_CODES.MANIFEST_DISAGREEMENT,
            "the selected descriptor and the bound documentation manifest disagree about this reference"
          );
        }

        const absolute = path.resolve(docsCarrier.packageRoot, entry.bundlePath);
        const containmentRoot = `${docsCarrier.docsRoot}${path.sep}`;
        if (!absolute.startsWith(containmentRoot)) {
          throw toolDocReadRefusal(
            TOOL_DOC_READ_DIAGNOSTIC_CODES.PATH_CONTAINMENT,
            "the manifest entry does not resolve inside the bound documentation bundle"
          );
        }

        let text;
        try {
          text = await readFile(absolute, "utf8");
        } catch {
          throw toolDocReadRefusal(
            TOOL_DOC_READ_DIAGNOSTIC_CODES.READ_FAILED,
            "the bound package documentation file could not be read"
          );
        }

        return jsonContent({
          schema_version: "tool-doc-read.v1",
          ok: true,
          tool_name: args.tool_name,
          path: entry.logicalPath,
          scope: TOOL_DOC_REFERENCE_SCOPE_PACKAGE,
          owner_package: docsCarrier.packageName,
          owner_package_version: docsCarrier.packageVersion,
          sha256: entry.sha256,
          bytes: entry.bytes,
          text
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
