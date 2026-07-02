

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeObject(value) {
  return Object.freeze(value);
}

function maybeCopyObject(value) {
  return isPlainObject(value) ? freezeObject({ ...value }) : null;
}

function assignCompatFields(payload, compat) {
  if (!isPlainObject(compat)) return;
  for (const [key, value] of Object.entries(compat)) {
    if (typeof key !== "string" || key.length === 0) continue;
    payload[key] = value === undefined ? null : value;
  }
}

export function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildRefusalEnvelope({
  schemaVersion,
  code,
  reason = null,
  detail = null
} = {}) {
  return freezeObject({
    schema_version: schemaVersion ?? null,
    accepted: false,
    refusal: freezeObject({
      code,
      reason: reason ?? null,
      detail: detail ?? null
    })
  });
}

export function buildFindingsPayload({
  schemaVersion,
  format = null,
  role = null,
  subject = null,
  source = null,
  compat = null,
  text
} = {}) {
  const payload = {
    schema_version: schemaVersion ?? null,
    format: format ?? null,
    text
  };
  const normalizedRole = normalizeNonEmptyString(role);
  if (normalizedRole !== null) {
    payload.role = normalizedRole;
  }
  const normalizedSubject = normalizeNonEmptyString(subject);
  if (normalizedSubject !== null) {
    payload.subject = normalizedSubject;
  }
  const normalizedSource = maybeCopyObject(source);
  if (normalizedSource !== null) {
    payload.source = normalizedSource;
  }
  assignCompatFields(payload, compat);
  return freezeObject(payload);
}

export function buildNoFindingsPayload({
  reason = null,
  format = null,
  role = null,
  subject = null,
  source = null,
  compat = null,
  text
} = {}) {
  const payload = {
    reason: reason ?? null,
    format: format ?? null,
    text
  };
  const normalizedRole = normalizeNonEmptyString(role);
  if (normalizedRole !== null) {
    payload.role = normalizedRole;
  }
  const normalizedSubject = normalizeNonEmptyString(subject);
  if (normalizedSubject !== null) {
    payload.subject = normalizedSubject;
  }
  const normalizedSource = maybeCopyObject(source);
  if (normalizedSource !== null) {
    payload.source = normalizedSource;
  }
  assignCompatFields(payload, compat);
  return freezeObject(payload);
}

export function buildFinalResultEnvelope({ kind, payload } = {}) {
  const normalizedKind = normalizeNonEmptyString(kind);
  if (normalizedKind === null) {
    return null;
  }
  return freezeObject({
    kind: normalizedKind,
    [normalizedKind]: payload ?? null
  });
}

export function normalizeLaunchInput(input, allowedFields) {
  if (!isPlainObject(input) || !Array.isArray(allowedFields)) {
    return freezeObject({});
  }

  const normalized = {};
  for (const field of allowedFields) {
    if (typeof field !== "string" || field.length === 0) continue;
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      normalized[field] = input[field];
    }
  }
  return freezeObject(normalized);
}

export async function probeRuntimeSymlink({
  symlinkPath,
  reasons,
  fsLstat,
  fsReadlink,
  fsStat
}) {
  let lst;
  try {
    lst = await fsLstat(symlinkPath);
  } catch (err) {
    return {
      available: false,
      reason: reasons.PATH_UNREADABLE,
      detail: {
        symlink_path: symlinkPath,
        target_path: null,
        code: err?.code ?? null,
        message: err?.message ?? String(err)
      }
    };
  }
  const isSymlink = lst.isSymbolicLink();
  let targetPath = null;
  if (isSymlink) {
    try {
      targetPath = await fsReadlink(symlinkPath);
    } catch (err) {
      return {
        available: false,
        reason: reasons.PATH_UNREADABLE,
        detail: {
          symlink_path: symlinkPath,
          target_path: null,
          code: err?.code ?? null,
          message: err?.message ?? String(err)
        }
      };
    }
  }
  let st;
  try {
    st = await fsStat(symlinkPath);
  } catch (err) {
    if (isSymlink && targetPath !== null && err?.code === "ENOENT") {
      return {
        available: true,
        detail: {
          symlink_path: symlinkPath,
          target_path: targetPath,
          size: null,
          mode: null,
          target_visibility: "deferred_to_worker_bwrap",
          follow_error: {
            code: err?.code ?? null,
            message: err?.message ?? String(err)
          }
        }
      };
    }
    return {
      available: false,
      reason: reasons.SYMLINK_TARGET_MISSING,
      detail: {
        symlink_path: symlinkPath,
        target_path: targetPath,
        code: err?.code ?? null,
        message: err?.message ?? String(err)
      }
    };
  }
  if (!st.isFile()) {
    return {
      available: false,
      reason: reasons.NOT_FILE,
      detail: {
        symlink_path: symlinkPath,
        target_path: targetPath,
        mode: st.mode
      }
    };
  }
  if ((st.mode & 0o111) === 0) {
    return {
      available: false,
      reason: reasons.NOT_EXECUTABLE,
      detail: {
        symlink_path: symlinkPath,
        target_path: targetPath,
        mode: st.mode
      }
    };
  }
  return {
    available: true,
    detail: {
      symlink_path: symlinkPath,
      target_path: targetPath,
      size: st.size,
      mode: st.mode
    }
  };
}

export function createApprovedReadOnlyFileGuard({
  approvedFiles,
  refusalCode,
  reason,
  valueKey,
  allowedKey,
  errorClass,
  messagePrefix = ""
}) {
  const approved = Object.freeze([
    ...(Array.isArray(approvedFiles) ? approvedFiles : [])
  ]);
  function fail(value) {
    throw new errorClass(`${messagePrefix}${reason}`, {
      code: refusalCode,
      detail: {
        [valueKey]: value,
        [allowedKey]: Object.freeze([...approved])
      }
    });
  }
  function assertAllowed(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string" || value.length === 0) {
      fail(value);
    }
    if (!approved.includes(value)) {
      fail(value);
    }
    return value;
  }
  function isRefusal(err) {
    return err instanceof errorClass
      && err.code === refusalCode
      && typeof err.detail === "object"
      && err.detail !== null
      && Object.hasOwn(err.detail, valueKey)
      && Object.hasOwn(err.detail, allowedKey);
  }
  return { assertAllowed, isRefusal };
}
