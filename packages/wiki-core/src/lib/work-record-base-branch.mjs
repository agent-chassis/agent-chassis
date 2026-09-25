

export function isCanonicalWorkRecordBaseBranch(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (value === "@" || value.startsWith("refs/") || value.startsWith("-") ||
      value.startsWith("/") || value.endsWith("/") || value.endsWith(".") ||
      value.includes("..") || value.includes("//") || value.includes("@{")) {
    return false;
  }
  if (/[\u0000-\u0020\u007f~^:?*[\\]/u.test(value)) return false;
  return value.split("/").every((component) =>
    component.length > 0 && component !== "." && component !== ".." &&
    !component.startsWith(".") && !component.endsWith(".lock"));
}
