

export function normalizeRepositoryRelativePath(value) {
  return String(value).trim().replace(/^\.\//u, "");
}

export function isRepositoryRelativePath(value) {
  const normalized = normalizeRepositoryRelativePath(value);
  const segments = normalized.split("/");
  return !(
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  );
}
