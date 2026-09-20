import assert from "node:assert/strict";
import test from "node:test";

import {
  LITERAL_COMMIT_PARSE_REASONS as REASONS,
  parseLiteralCommitObject
} from "../../packages/agent-launch-cli/src/lib/literal-commit-object.mjs";

const OID = "a".repeat(40);
const TREE = "b".repeat(40);
const PARENT = "c".repeat(40);
const HEADERS = `tree ${TREE}\nparent ${PARENT}\n` +
  "author Test <test@example.com> 1 +0000\ncommitter Test <test@example.com> 1 +0000";

function parse(raw, oid = OID) {
  return parseLiteralCommitObject(raw, oid);
}

test("literal commit parser: message bytes are returned verbatim, including CR, CRLF, NUL and control bytes", () => {
  for (const message of [
    "Add a GetConfig method (#387)\n\n* Update rule.go\r\n\r\n* Update rule_test.go\r\n",
    "subject\r\n",
    "lone\rcarriage return",
    "nul\0inside\n",
    "tab\tbell\x07del\x7f\n",
    "",
    "\n\nleading blank lines\n"
  ]) {
    const parsed = parse(`${HEADERS}\n\n${message}`);
    assert.equal(parsed.ok, true, JSON.stringify(message));
    assert.equal(parsed.commit.message, message);
    assert.equal(parsed.commit.oid, OID);
    assert.equal(parsed.commit.tree, TREE);
    assert.deepEqual(parsed.commit.parents, [PARENT]);
  }
});

test("literal commit parser: a CRLF rendering of a message is never equal to its LF form", () => {
  const lf = "agent-launch worker delivery: WK-1#SLICE-001\n\nWk-Slice: WK-1#SLICE-001\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  assert.equal(parse(`${HEADERS}\n\n${crlf}`).commit.message === lf, false);
});

test("literal commit parser: structural headers stay strict and report a stable reason", () => {
  const cases = [
    [42, REASONS.BODY_NOT_STRING],
    [HEADERS, REASONS.HEADER_SEPARATOR_MISSING],
    [`\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [`${HEADERS}\r\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [HEADERS.replace("author Test", "author Te\rst") + "\n\nmessage", REASONS.HEADER_LINE_MALFORMED],
    [HEADERS.replace("author Test", "author Te\0st") + "\n\nmessage", REASONS.HEADER_LINE_MALFORMED],
    [`${HEADERS}\nNOT-A-HEADER\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [` orphan continuation\n${HEADERS}\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [`tree ${TREE}\n continuation\nparent ${PARENT}\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [`${HEADERS}\ngpgsig x\n bad\rcontinuation\n\nmessage`, REASONS.HEADER_LINE_MALFORMED],
    [HEADERS.replace("author Test", "author T�st") + "\n\nmessage", REASONS.HEADER_BYTES_UNREPRESENTABLE],
    [HEADERS.replace(`tree ${TREE}\n`, "") + "\n\nmessage", REASONS.TREE_HEADER_INVALID],
    [`tree ${TREE}\n${HEADERS}\n\nmessage`, REASONS.TREE_HEADER_INVALID],
    [HEADERS.replace(TREE, TREE.toUpperCase()) + "\n\nmessage", REASONS.TREE_HEADER_INVALID],
    [HEADERS.replace(PARENT, PARENT.slice(1)) + "\n\nmessage", REASONS.PARENT_HEADER_INVALID],
    [`${HEADERS}\n\nundecodable � byte`, REASONS.MESSAGE_BYTES_UNREPRESENTABLE]
  ];
  for (const [raw, reason] of cases) {
    const parsed = parse(raw);
    assert.equal(parsed.ok, false, JSON.stringify(raw));
    assert.equal(parsed.reason, reason, JSON.stringify(raw));
    assert.equal("commit" in parsed, false);
  }
});

test("literal commit parser: tree and parent ids must match the object format of the read oid", () => {
  const sha256Oid = "d".repeat(64);
  const parsed = parse(`${HEADERS}\n\nmessage`, sha256Oid);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, REASONS.TREE_HEADER_INVALID);
  const headers = HEADERS.replace(TREE, "e".repeat(64));
  assert.equal(parse(`${headers}\n\nmessage`, sha256Oid).reason, REASONS.PARENT_HEADER_INVALID);
});

test("literal commit parser: valid multiline continuations are accepted", () => {
  const parsed = parse(
    `${HEADERS}\ngpgsig -----BEGIN PGP SIGNATURE-----\n continuation\n \n -----END PGP SIGNATURE-----\n\nmsg\r\n`
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.commit.message, "msg\r\n");
});
