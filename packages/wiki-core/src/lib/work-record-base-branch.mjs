

export const WORK_RECORD_BASE_BRANCH_SCHEMA = Object.freeze({ type: 'string', format: 'local_branch_name',
  description: 'A local branch name, at most 1024 UTF-16 code units. No refs/ prefix, revision expression, leading - or /, trailing / or ., empty component, dot-prefixed component, .lock suffix, .., //, @{, whitespace/control character, ~, ^, :, ?, *, [, or backslash; @ alone is invalid. Choose the intended branch; syntax does not establish its existence.' });
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
