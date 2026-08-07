

import { validateWorkRecord } from "./work-record-schema.mjs";
import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";

export const RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
export const INITIATIVE_ID_PATTERN = /^IN-[0-9]{4}$/;
export const ORDINAL_SLICE_ID_PATTERN = /^SLICE-[0-9]{3}$/;

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}

export function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

export function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function collectJsonDiffPaths(left, right, path = "", paths = []) {
  const leftObject = isObject(left);
  const rightObject = isObject(right);
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftObject || rightObject) {
    const keys = new Set([
      ...(leftObject ? Object.keys(left) : []),
      ...(rightObject ? Object.keys(right) : [])
    ]);
    if (keys.size === 0 && leftObject !== rightObject) {
      paths.push(path);
      return paths;
    }
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      collectJsonDiffPaths(
        leftObject && hasOwn(left, key) ? left[key] : undefined,
        rightObject && hasOwn(right, key) ? right[key] : undefined,
        childPath,
        paths
      );
    }
    return paths;
  }

  if (leftArray || rightArray) {
    const length = Math.max(leftArray ? left.length : 0, rightArray ? right.length : 0);
    if (length === 0 && leftArray !== rightArray) {
      paths.push(path);
      return paths;
    }
    for (let index = 0; index < length; index += 1) {
      collectJsonDiffPaths(
        leftArray ? left[index] : undefined,
        rightArray ? right[index] : undefined,
        `${path}[${index}]`,
        paths
      );
    }
    return paths;
  }

  if (!jsonEqual(left, right)) {
    paths.push(path);
  }
  return paths;
}

export function diagnosticPathIsWithin(path, subtreePath) {
  return (
    isString(path) &&
    (path === subtreePath || path.startsWith(`${subtreePath}.`) || path.startsWith(`${subtreePath}[`))
  );
}

export function findSliceIndexes(record, sliceId) {
  if (!Array.isArray(record?.slices)) {
    return [];
  }
  const indexes = [];
  record.slices.forEach((entry, index) => {
    if (isObject(entry) && entry.id === sliceId) {
      indexes.push(index);
    }
  });
  return indexes;
}

export function parseWorkRecordUnitAddress(unitAddress) {
  const normalized = isString(unitAddress) ? unitAddress.trim() : "";
  if (!normalized) {
    return {
      ok: false,
      error: createDiagnostic("invalid_unit_address", "unit address is required", {
        path: "unit"
      })
    };
  }

  const pieces = normalized.split("#");
  if (pieces.length > 2 || !RECORD_ID_PATTERN.test(pieces[0])) {
    return {
      ok: false,
      error: createDiagnostic("invalid_unit_address", `Invalid unit address: ${normalized}`, {
        path: "unit"
      })
    };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      recordId: pieces[0],
      unit: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      }
    };
  }

  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      error: createDiagnostic("invalid_slice_id", `Invalid slice id: ${sliceId}`, {
        path: "unit"
      })
    };
  }

  return {
    ok: true,
    recordId: pieces[0],
    unit: {
      kind: "slice",
      address: normalized,
      record_id: pieces[0],
      slice_id: sliceId
    }
  };
}

export function defaultSliceTemplate(id) {
  return {
    id,
    title: "",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [],
      validation: []
    }
  };
}

export function findSliceIndex(record, sliceId) {
  if (!Array.isArray(record.slices)) {
    return -1;
  }
  return record.slices.findIndex((entry) => isObject(entry) && entry.id === sliceId);
}

export function isOrdinalSliceId(sliceId) {
  return isString(sliceId) && ORDINAL_SLICE_ID_PATTERN.test(sliceId);
}

export function nextOrdinalSliceId(record) {
  const usedOrdinals = new Set();
  if (Array.isArray(record.slices)) {
    for (const slice of record.slices) {
      if (!isObject(slice) || !isOrdinalSliceId(slice.id)) {
        continue;
      }
      usedOrdinals.add(slice.id);
    }
  }

  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const candidate = `SLICE-${String(ordinal).padStart(3, "0")}`;
    if (!usedOrdinals.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function prefixSliceField(sliceId, fieldPath) {
  return sliceId ? `slices[${sliceId}].${fieldPath}` : fieldPath;
}

export function collectContractPolicyDiagnostics(record) {
  const diagnostics = [];

  if (
    record.work_kind === "review" &&
    Array.isArray(record.write_scope) &&
    record.write_scope.length > 0
  ) {
    diagnostics.push(
      createDiagnostic(
        "review_write_scope_not_empty",
        "record work_kind 'review' requires an empty write_scope",
        { path: "write_scope" }
      )
    );
  }

  if (Array.isArray(record.slices)) {
    const seen = new Set();
    record.slices.forEach((slice, index) => {
      if (!isObject(slice)) {
        return;
      }
      if (isString(slice.id)) {
        if (seen.has(slice.id)) {
          diagnostics.push(
            createDiagnostic("duplicate_slice_id", `slice id '${slice.id}' is not unique within the record`, {
              path: `slices[${index}].id`
            })
          );
        }
        seen.add(slice.id);
      }
      if (
        slice.work_kind === "review" &&
        Array.isArray(slice.write_scope) &&
        slice.write_scope.length > 0
      ) {
        diagnostics.push(
          createDiagnostic(
            "review_write_scope_not_empty",
            `slice '${slice.id}' work_kind 'review' requires an empty write_scope`,
            { path: `slices[${index}].write_scope` }
          )
        );
      }
    });
  }

  return diagnostics;
}

export function finalizeEdit(updatedRecord, changedFields) {
  const diagnostics = [
    ...validateWorkRecord(updatedRecord),
    ...collectContractPolicyDiagnostics(updatedRecord)
  ];
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { ok: false, updatedRecord: null, changedFields: [], diagnostics };
  }
  return { ok: true, updatedRecord, changedFields, diagnostics };
}

export function refusal(diagnostic) {
  return {
    ok: false,
    updatedRecord: null,
    changedFields: [],
    diagnostics: [diagnostic]
  };
}

export function selectScopedTarget(clone, sliceId) {
  if (sliceId === null || sliceId === undefined) {
    return { ok: true, target: clone };
  }
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      refusal: refusal(
        createDiagnostic("invalid_slice_id", `Invalid slice id: ${sliceId}`, { path: "unit" })
      )
    };
  }
  const index = findSliceIndex(clone, sliceId);
  if (index === -1) {
    return {
      ok: false,
      refusal: refusal(
        createDiagnostic("slice_not_found", `Slice '${sliceId}' does not exist on ${clone.id}`, {
          path: "unit"
        })
      )
    };
  }
  return { ok: true, target: clone.slices[index] };
}
