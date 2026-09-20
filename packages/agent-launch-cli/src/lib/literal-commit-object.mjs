

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CONTROL_RE = /[\x00-\x1f\x7f]/u;

export const LITERAL_COMMIT_PARSE_REASONS = Object.freeze({
  BODY_NOT_STRING: "body_not_string",
  HEADER_SEPARATOR_MISSING: "header_separator_missing",
  HEADER_BYTES_UNREPRESENTABLE: "header_bytes_unrepresentable",
  HEADER_LINE_MALFORMED: "header_line_malformed",
  TREE_HEADER_INVALID: "tree_header_invalid",
  PARENT_HEADER_INVALID: "parent_header_invalid",
  MESSAGE_BYTES_UNREPRESENTABLE: "message_bytes_unrepresentable"
});

const REASONS = LITERAL_COMMIT_PARSE_REASONS;

function refused(reason) {
  return Object.freeze({ ok: false, reason });
}

export function parseLiteralCommitObject(raw, oid) {
  if (typeof raw !== "string") return refused(REASONS.BODY_NOT_STRING);
  const separator = raw.indexOf("\n\n");
  if (separator < 0) return refused(REASONS.HEADER_SEPARATOR_MISSING);
  const headerSection = raw.slice(0, separator);
  if (headerSection.includes("�")) return refused(REASONS.HEADER_BYTES_UNREPRESENTABLE);
  const lines = headerSection.split("\n");
  const headers = [];
  let continuedKey = null;
  for (const line of lines) {
    if (line.length === 0) return refused(REASONS.HEADER_LINE_MALFORMED);
    if (line.startsWith(" ")) {
      if (continuedKey === null || continuedKey === "tree" || continuedKey === "parent" ||
          CONTROL_RE.test(line.slice(1))) {
        return refused(REASONS.HEADER_LINE_MALFORMED);
      }
      continue;
    }
    const space = line.indexOf(" ");
    if (space <= 0 || space === line.length - 1) return refused(REASONS.HEADER_LINE_MALFORMED);
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (!/^[\x21-\x7e]+$/u.test(key) || value.startsWith(" ") || CONTROL_RE.test(value)) {
      return refused(REASONS.HEADER_LINE_MALFORMED);
    }
    headers.push({ key, value });
    continuedKey = key;
  }
  const trees = headers.filter(({ key }) => key === "tree");
  if (trees.length !== 1 || !OID_RE.test(trees[0].value) || trees[0].value.length !== oid.length) {
    return refused(REASONS.TREE_HEADER_INVALID);
  }
  const parents = headers.filter(({ key }) => key === "parent").map(({ value }) => value);
  if (parents.some((parent) => !OID_RE.test(parent) || parent.length !== oid.length)) {
    return refused(REASONS.PARENT_HEADER_INVALID);
  }
  const message = raw.slice(separator + 2);
  if (message.includes("�")) return refused(REASONS.MESSAGE_BYTES_UNREPRESENTABLE);
  return Object.freeze({
    ok: true,
    commit: Object.freeze({
      oid,
      tree: trees[0].value,
      parents: Object.freeze(parents),
      message
    })
  });
}
