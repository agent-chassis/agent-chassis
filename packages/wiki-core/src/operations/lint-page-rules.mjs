import path from "node:path";
import { resolvePageFacets, validateRetrievalRoleValues } from "../lib/wiki.mjs";
import { checkWorkRecordRenderProjectionRecord } from "../lib/work-record-renderer.mjs";
import {
  compareWorkRecordMarkdownProjection,
  extractMarkdownProjectionMetadata
} from "./lint-markdown-projection.mjs";
import { normalizeDiagnosticPath } from "./lint-shared.mjs";

export function lintPageFacets({
  allPages,
  facetContext,
  manifest,
  declaredTopics,
  reservedTopicSlugs,
  allocatedWorkRecordRecordsById,
  targetDir,
  addFinding
}) {
  for (const page of allPages) {
    const { inferred, explicit, effective } = resolvePageFacets(page, facetContext);
    const relativePath = page.relativePath;

    for (const [fieldName, allowed] of Object.entries(manifest.retrieval?.facets || {})) {
      if (!(fieldName in explicit)) {
        continue;
      }

      if (fieldName === "retrieval_role") {
        const comboError = validateRetrievalRoleValues(explicit.retrieval_role, manifest);
        if (comboError) {
          addFinding("error", `${relativePath}: invalid retrieval_role: ${comboError}`, {
            code: "invalid_retrieval_role",
            path: relativePath
          });
        }
        continue;
      }

      if (!allowed.values.includes(String(explicit[fieldName]).toLowerCase())) {
        addFinding(
          "error",
          `${relativePath}: unsupported value for ${fieldName}: ${JSON.stringify(explicit[fieldName])}`,
          { code: "invalid_retrieval_facet", path: relativePath }
        );
      }
    }

    for (const fieldName of ["canonicality", "maintenance_mode", "knowledge_role"]) {
      if (!(fieldName in explicit)) {
        continue;
      }
      if (
        fieldName in inferred &&
        explicit[fieldName] !== inferred[fieldName]
      ) {
        addFinding(
          "error",
          `${relativePath}: explicit ${fieldName}=${JSON.stringify(explicit[fieldName])} conflicts with inferred default ${JSON.stringify(inferred[fieldName])}`,
          { code: "retrieval_facet_conflict", path: relativePath }
        );
      }
    }

    if (effective.knowledge_role !== "evidence" && effective.evidence_stage) {
      addFinding(
        "error",
        `${relativePath}: evidence_stage is only valid when knowledge_role=evidence`,
        { code: "invalid_evidence_stage_usage", path: relativePath }
      );
    }

    if (effective.canonicality === "canonical" && effective.maintenance_mode === "generated") {
      addFinding(
        "error",
        `${relativePath}: canonical pages cannot be generated`,
        { code: "invalid_canonical_generated_combo", path: relativePath }
      );
    }

    const effectiveRoles = Array.isArray(effective.retrieval_role)
      ? effective.retrieval_role
      : [];
    const effectiveRoleError = validateRetrievalRoleValues(effectiveRoles, manifest);
    if (effectiveRoles.length > 0 && effectiveRoleError) {
      addFinding("error", `${relativePath}: invalid effective retrieval_role: ${effectiveRoleError}`, {
        code: "invalid_retrieval_role",
        path: relativePath
      });
    }

    if (
      effectiveRoles.includes("entrypoint") &&
      effective.retrieval_visibility === "suppressed"
    ) {
      addFinding(
        "error",
        `${relativePath}: entrypoint pages cannot have retrieval_visibility=suppressed`,
        { code: "invalid_entrypoint_visibility", path: relativePath }
      );
    }

    for (const topic of explicit.topics || []) {
      if (!declaredTopics.has(topic)) {
        addFinding(
          "error",
          `${relativePath}: undeclared local topic '${topic}'`,
          { code: "undeclared_topic", path: relativePath }
        );
      }
      if (reservedTopicSlugs.has(topic)) {
        addFinding(
          "error",
          `${relativePath}: topic '${topic}' collides with a canonical extension or area slug`,
          { code: "topic_slug_collision", path: relativePath }
        );
      }
    }

    if (page.relativePath.startsWith("wiki/issues/")) {
      const recordId = String(page.frontmatter?.id || path.basename(page.relativePath, ".md"));
      const canonicalWorkRecord = allocatedWorkRecordRecordsById.get(recordId) || null;
      const markdownProjection = extractMarkdownProjectionMetadata(page.body);
      if (canonicalWorkRecord && markdownProjection) {
        if (!markdownProjection.metadata) {
          addFinding(
            "error",
            `${relativePath}: missing generated-source metadata for JSON-backed work record projection`,
            {
              code: "missing_generated_source_metadata",
              path: relativePath
            }
          );
        } else {
          const projectionDiagnostics = checkWorkRecordRenderProjectionRecord(
            markdownProjection.metadata,
            {
              sourceRecord: canonicalWorkRecord.record
            }
          );

          for (const diagnostic of projectionDiagnostics.diagnostics) {
            addFinding(diagnostic.severity, diagnostic.message, {
              code: diagnostic.code,
              path: relativePath,
              metadata_path: diagnostic.path || null
            });
          }
        }
      }
      if (canonicalWorkRecord) {
        const divergence = compareWorkRecordMarkdownProjection(
          canonicalWorkRecord.record,
          page.frontmatter || {},
          {
            recordId,
            canonicalPath:
              canonicalWorkRecord.source_path_relative ||
              normalizeDiagnosticPath(targetDir, canonicalWorkRecord.source_path) ||
              canonicalWorkRecord.source_path,
            markdownPath: relativePath
          }
        );
        if (divergence) {
          addFinding("error", divergence.message, {
            code: "json_markdown_work_record_divergence",
            path: relativePath,
            record_id: recordId,
            canonical_path: divergence.canonical_path,
            markdown_path: divergence.markdown_path,
            divergent_fields: divergence.divergent_fields
          });
        }
      }
    }
  }
}
