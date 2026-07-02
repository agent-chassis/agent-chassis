

export function extractMarkdownProjectionMetadata(markdown) {
  const body = String(markdown ?? "");
  const hasProjectionMarker =
    body.includes("<!-- generated: do not edit manually -->") ||
    body.includes("## Generated Source");
  const sectionStart = body.indexOf("## Generated Source");

  if (sectionStart === -1) {
    return hasProjectionMarker ? { metadata: null } : null;
  }

  const sectionLines = body.slice(sectionStart).split("\n");
  const metadata = {};

  for (let index = 1; index < sectionLines.length; index += 1) {
    const line = sectionLines[index];
    if (/^##\s+/.test(line.trim())) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed === "- None" || !trimmed.startsWith("- ")) {
      continue;
    }

    const match = trimmed.match(/^- ([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const rawValue = match[2].trim();
    if (key === "renderer") {
      const rendererMatch = rawValue.match(/^`([^`]+)`\s+`([^`]+)`$/);
      if (rendererMatch) {
        metadata.renderer = {
          name: unescapeInlineCode(rendererMatch[1]),
          version: unescapeInlineCode(rendererMatch[2])
        };
      } else if (rawValue) {
        metadata.renderer = rawValue;
      }
      continue;
    }

    metadata[key] = parseMarkdownProjectionScalar(rawValue);
  }

  return {
    metadata,
    hasProjectionMarker
  };
}

export function parseMarkdownProjectionScalar(rawValue) {
  if (!rawValue) {
    return "";
  }

  const backtickMatch = rawValue.match(/^`([\s\S]*)`$/);
  if (backtickMatch) {
    return unescapeInlineCode(backtickMatch[1]);
  }

  return rawValue;
}

export function unescapeInlineCode(value) {
  return String(value).replaceAll("\\`", "`");
}

export function compareWorkRecordMarkdownProjection(
  canonicalRecord,
  markdownFrontmatter,
  { recordId, canonicalPath, markdownPath }
) {
  const divergentFields = [];

  for (const fieldName of ["title", "status", "resolution", "updated"]) {
    const canonicalValue = normalizeMirrorFieldValue(canonicalRecord?.[fieldName]);
    const markdownValue = normalizeMirrorFieldValue(markdownFrontmatter?.[fieldName]);
    if (canonicalValue !== markdownValue) {
      divergentFields.push({
        field: fieldName,
        canonical: canonicalValue,
        markdown: markdownValue
      });
    }
  }

  if (divergentFields.length === 0) {
    return null;
  }

  const fieldSummary = divergentFields
    .map(
      ({ field, canonical, markdown }) =>
        `${field} (${formatMirrorFieldValue(canonical)} vs ${formatMirrorFieldValue(markdown)})`
    )
    .join(", ");

  return {
    message: `${markdownPath}: work record ${recordId} diverges from canonical JSON ${canonicalPath} for ${fieldSummary}; JSON is canonical for migrated work records, so regenerate or update the Markdown projection to match.`,
    canonical_path: canonicalPath,
    markdown_path: markdownPath,
    divergent_fields: divergentFields
  };
}

export function normalizeMirrorFieldValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return String(value);
}

export function formatMirrorFieldValue(value) {
  const normalized = normalizeMirrorFieldValue(value);
  return normalized === null ? "null" : JSON.stringify(normalized);
}

export function findUncheckedChecklistItems(body) {
  const lines = String(body ?? "").split("\n");
  const uncheckedItems = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (/^\s*(?:[-+*]|\d+\.)\s+\[ \]\s+/.test(line)) {
      uncheckedItems.push({
        line: index + 1,
        text: line.trim()
      });
    }
  }

  return uncheckedItems;
}
