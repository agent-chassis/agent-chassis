

import { getRecordKindSpec } from "./work-record-kind-registry.mjs";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isSimpleYamlScalar(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value);
}

function renderYamlScalar(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return isSimpleYamlScalar(value) ? value : JSON.stringify(value);
  }
  if (Array.isArray(value) || isObject(value)) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function renderYamlValue(value, indentLevel = 0) {
  const indent = " ".repeat(indentLevel);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}[]`;
    }
    return value
      .map((entry) => {
        if (Array.isArray(entry) || isObject(entry)) {
          const nested = renderYamlValue(entry, indentLevel + 2).split("\n");
          return `${indent}- ${nested[0].trimStart()}\n${nested.slice(1).join("\n")}`;
        }
        return `${indent}- ${renderYamlScalar(entry)}`;
      })
      .join("\n");
  }

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `${indent}{}`;
    }
    return keys
      .map((key) => {
        const nestedValue = value[key];
        if (Array.isArray(nestedValue) || isObject(nestedValue)) {
          const rendered = renderYamlValue(nestedValue, indentLevel + 2);
          return `${indent}${key}:\n${rendered}`;
        }
        return `${indent}${key}: ${renderYamlScalar(nestedValue)}`;
      })
      .join("\n");
  }

  return `${indent}${renderYamlScalar(value)}`;
}

function renderYamlLine(key, value) {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return `${key}:`;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? `${key}: []` : `${key}:\n${renderYamlValue(value, 2)}`;
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0 ? `${key}: {}` : `${key}:\n${renderYamlValue(value, 2)}`;
  }
  return `${key}: ${renderYamlScalar(value)}`;
}

function sectionHeading(key) {
  return String(key)
    .split("_")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

const KIND_FACET_LIFECYCLE = Object.freeze({
  decision: "stable",
  initiative: "active"
});

function unsupportedKindResult(recordKind) {
  return {
    valid: false,
    diagnostics: [
      {
        code: "unsupported_record_kind",
        severity: "error",
        message: `Unsupported record kind: ${recordKind}`,
        path: "record_kind"
      }
    ],
    markdown: null
  };
}

function frontmatterKeyOrder(spec) {
  return [...Object.keys(spec.requiredTopLevel), ...Object.keys(spec.optionalTopLevel)].filter(
    (key) => key !== "record_kind"
  );
}

function renderFrontmatterBlock(record, spec) {
  return frontmatterKeyOrder(spec)
    .filter((key) => hasOwn(record, key))
    .map((key) => renderYamlLine(key, record[key]))
    .filter((line) => line !== null)
    .join("\n");
}

function renderBodySections(record, spec) {
  const sections = isObject(record.sections) ? record.sections : {};
  const blocks = [];
  for (const key of Object.keys(spec.sectionSpec)) {
    if (!hasOwn(sections, key)) {
      continue;
    }
    const value = sections[key];
    if (!isString(value)) {
      continue;
    }
    const normalized = value.trim();
    if (normalized === "") {

      continue;
    }
    blocks.push(`## ${sectionHeading(key)}`, "", normalized, "");
  }
  return blocks;
}

function buildKindMarkdown(record, spec) {
  const lifecycle = KIND_FACET_LIFECYCLE[spec.recordKind] ?? "active";
  const frontmatter = renderFrontmatterBlock(record, spec);
  const bodyBlocks = renderBodySections(record, spec);
  const title = isString(record.title) ? record.title : "(missing)";

  const lines = [
    "---",
    frontmatter,
    "# Retrieval facets are inferred from path/template by default.",
    "# Add overrides only when needed:",
    `# lifecycle: ${lifecycle}`,
    "# retrieval_visibility: support",
    "# topics: []",
    "---",
    "",
    `# ${title}`,
    ""
  ];
  if (bodyBlocks.length > 0) {

    lines.push(...bodyBlocks.slice(0, -1));
  }

  return `${lines.join("\n")}\n`;
}

export function renderDecisionMarkdown(record) {
  return buildKindMarkdown(record, getRecordKindSpec("decision"));
}

export function renderInitiativeMarkdown(record) {
  return buildKindMarkdown(record, getRecordKindSpec("initiative"));
}

export function renderRecordByKindMarkdown(record) {
  if (!isObject(record)) {
    return {
      valid: false,
      diagnostics: [
        { code: "invalid_record", severity: "error", message: "record must be an object", path: null }
      ],
      markdown: null
    };
  }
  if (!hasOwn(record, "record_kind") || !isString(record.record_kind)) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: "record_kind is required",
          path: "record_kind"
        }
      ],
      markdown: null
    };
  }
  const spec = getRecordKindSpec(record.record_kind);

  if (!spec || spec.recordKind === "work_item") {
    return unsupportedKindResult(record.record_kind);
  }
  return {
    valid: true,
    diagnostics: [],
    markdown: buildKindMarkdown(record, spec)
  };
}
