

export const TASK_RESULT_PROJECTION_VOCABULARY = Object.freeze({
  semantic_scope: "task_relevant_public",
  compact_omission: Object.freeze({
    cause: "task_directed_projection",
    complete_path: "typed_query"
  }),
  continuation: Object.freeze({
    collection_rows: "typed_collection",
    structured_values: "typed_field_projection",
    scalar_values: "offset_length_total_range"
  }),
  accounting: Object.freeze({
    total: "total",
    returned: "returned",
    remaining: "remaining",
    continuation: "continuation"
  }),
  authority: "non_authorizing"
});

function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function stableString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${field} must be a non-empty stable string`);
  }
  return value;
}

export function defineTaskResultCollectionDescriptors(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError("task-result collection descriptors must be an array");
  }
  const seen = new Set();
  return Object.freeze(rows.map((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`task-result collection descriptor ${index} must be an object`);
    }
    const collection = stableString(row.collection, `descriptor ${index} collection`);
    if (seen.has(collection)) {
      throw new TypeError(`duplicate task-result collection ${collection}`);
    }
    seen.add(collection);
    const stableId = stableString(row.stable_id, `${collection} stable_id`);
    if (!Array.isArray(row.fields) || row.fields.length === 0 ||
        !row.fields.every((field) => typeof field === "string" && field.length > 0)) {
      throw new TypeError(`${collection} fields must be a non-empty string array`);
    }
    if (!row.fields.includes(stableId)) {
      throw new TypeError(`${collection} fields must include stable_id ${stableId}`);
    }
    const selectors = row.selectors ?? ["id"];
    if (!Array.isArray(selectors) || selectors.length === 0 ||
        !selectors.every((selector) => typeof selector === "string" && selector.length > 0)) {
      throw new TypeError(`${collection} selectors must be a non-empty string array`);
    }
    return Object.freeze({
      collection,
      stable_id: stableId,
      fields: Object.freeze([...row.fields]),
      selectors: Object.freeze([...selectors])
    });
  }));
}

export function taskResultPageAccounting({ total, offset = 0, returned, cursor = null }) {
  integer(total, "total");
  integer(offset, "offset");
  integer(returned, "returned");
  if (offset > total || offset + returned > total) {
    throw new RangeError("task-result page accounting exceeds the selected population");
  }
  if (cursor !== null && (typeof cursor !== "string" || cursor.length === 0)) {
    throw new TypeError("task-result continuation cursor must be null or a non-empty string");
  }
  const remaining = total - offset - returned;
  if ((remaining === 0) !== (cursor === null)) {
    throw new TypeError("task-result continuation must exist exactly when rows remain");
  }
  return Object.freeze({
    total,
    returned,
    remaining,
    continuation: cursor === null
      ? null
      : Object.freeze({ kind: "cursor", cursor }),
    complete: remaining === 0
  });
}

export function taskResultScalarRangeAccounting({ total, offset, length }) {
  integer(total, "total");
  integer(offset, "offset");
  integer(length, "length");
  if (offset > total || offset + length > total) {
    throw new RangeError("task-result scalar range exceeds the selected scalar");
  }
  const remaining = total - offset - length;
  return Object.freeze({
    total,
    returned: length,
    remaining,
    continuation: remaining === 0
      ? null
      : Object.freeze({ kind: "scalar_range", next_offset: offset + length }),
    complete: remaining === 0
  });
}
