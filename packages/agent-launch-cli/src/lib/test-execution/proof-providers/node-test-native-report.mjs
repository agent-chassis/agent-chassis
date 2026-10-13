

import path from "node:path";
import { fileURLToPath } from "node:url";

import { nativeRecordFailureDiagnostic } from "../../workspace-agent-test-proof-error-diagnostic.mjs";

export const NODE_TEST_STARTUP_FAILURE_ORIGIN = Object.freeze({ kind: "condition",
  name: "uncaught_exception" });

export const NODE_TEST_NATIVE_REPORT_BOUNDS = Object.freeze({ lines: 256, message_bytes: 8192,
  details: 16, detail_bytes: 1024 });

const SGR_RE = /\u001b\[[0-9;]*m/gu;

const CARET_RE = /^\s*\^+\s*$/u;
const TERMINATOR_RE = /^Node\.js v\d+\.\d+\.\d+\S*$/u;
const HEADER_RE = /^([A-Za-z_$][\w$.]*)(?: \[([^\]\s]+)\])?(?:: (.*))?$/u;
const CODE_RE = /^[A-Z][A-Z0-9_]*$/u;
const FRAME_RE = /^ {4}at /u;
const FRAME_LOCATION_RE = /(?:^ {4}at (?:async )?|\()((?:file:\/\/)?\/[^()]*):(\d+):(\d+)\)?(?: \{)?$/u;
const CONTEXT_RE = /^(.+):(\d+)$/u;
const PROPERTY_RE = /^ {2}(\[?[A-Za-z_$][\w$]*\]?): (.*)$/u;
const QUOTED_RE = /^'([^'\\]*)'$/u;
const UNREAD_GRAPH_KEYS = Object.freeze({ "[cause]": "cause", "[errors]": "aggregate_errors" });

const unreadable = (member = "") => ({ path: `/native_report${member}`, reason: "native_report_unreadable" });
const overBudget = (member) => ({ path: `/native_report${member}`, reason: "capture_budget_exceeded" });

function checkoutFile(specifier, workRoot) {
  let file = specifier;
  if (specifier.startsWith("file://")) {
    try { file = fileURLToPath(specifier); } catch { return undefined; }
  }
  if (!path.isAbsolute(file)) return undefined;
  const relative = path.relative(workRoot, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function reportedLocation(context, frames, workRoot) {
  const sites = frames.map((frame) => FRAME_LOCATION_RE.exec(frame)).filter((site) => site !== null);
  const site = CONTEXT_RE.exec(context ?? "");
  const file = site === null ? undefined : checkoutFile(site[1], workRoot);
  if (file !== undefined) {
    const frame = sites.find(([, specifier, line]) => specifier === site[1] && line === site[2]);
    return { file, line: Number(site[2]), ...(frame === undefined ? {} : { column: Number(frame[3]) }) };
  }
  for (const [, specifier, line, column] of sites) {
    const frameFile = checkoutFile(specifier, workRoot);
    if (frameFile !== undefined) return { file: frameFile, line: Number(line), column: Number(column) };
  }
  return undefined;
}

function reportedProperties(lines, issues) {
  const facts = { details: [] };
  for (const [index, line] of lines.entries()) {
    const property = PROPERTY_RE.exec(line);
    if (property === null) continue;
    const key = property[1];
    const text = property[2].replace(/,$/u, "");
    if (Object.hasOwn(UNREAD_GRAPH_KEYS, key)) {
      issues.push(unreadable(`/${UNREAD_GRAPH_KEYS[key]}`));
      continue;
    }
    if (key.startsWith("[") || /[[{]$/u.test(text) || /^ {4}/u.test(lines[index + 1] ?? "")) continue;
    const quoted = QUOTED_RE.exec(text);
    if (key === "code" && quoted !== null && quoted[1].length > 0) facts.code = quoted[1];
    else if (facts.details.length >= NODE_TEST_NATIVE_REPORT_BOUNDS.details ||
        Buffer.byteLength(text, "utf8") > NODE_TEST_NATIVE_REPORT_BOUNDS.detail_bytes) {
      if (!issues.some(({ path: at }) => at === "/native_report/details")) issues.push(overBudget("/details"));
    } else facts.details.push({ label: key, text });
  }
  return facts;
}

function boundedMessage(lines, issues) {
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (bytes > NODE_TEST_NATIVE_REPORT_BOUNDS.message_bytes) {
      issues.push(overBudget("/message"));
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function unavailable(issues) {
  return nativeRecordFailureDiagnostic({ issues, origin: NODE_TEST_STARTUP_FAILURE_ORIGIN });
}

function reportDiagnosis({ context, lines: collected, overflow }, workRoot) {
  const lines = [...collected];

  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  const header = HEADER_RE.exec(lines[0] ?? "");
  if (header === null) return unavailable([unreadable()]);
  const issues = overflow ? [overBudget("")] : [];
  const closes = !overflow && lines.at(-1) === "}";
  const firstFrame = lines.findIndex((line) => FRAME_RE.test(line));
  let lastFrame = firstFrame;
  while (lastFrame >= 0 && FRAME_RE.test(lines[lastFrame + 1] ?? "")) lastFrame += 1;

  const opener = firstFrame >= 0 ? (lines[lastFrame].endsWith(" {") ? lastFrame : -1)
    : (closes ? lines.findIndex((line) => line.endsWith(" {")) : -1);
  const messageEnd = firstFrame >= 0 ? firstFrame : opener >= 0 ? opener + 1 : lines.length;
  const tail = firstFrame >= 0 ? lastFrame + 1 : messageEnd;
  const message = [header[3] ?? "", ...lines.slice(1, messageEnd)];
  if (firstFrame < 0 && opener >= 0) message[message.length - 1] = message.at(-1).slice(0, -2);
  let properties = { details: [] };
  if (opener >= 0 && closes) properties = reportedProperties(lines.slice(opener + 1, -1), issues);
  else if (!overflow && (opener >= 0 || tail < lines.length)) issues.push(unreadable());
  const text = boundedMessage(message, issues);
  const code = properties.code ?? (CODE_RE.test(header[2] ?? "") ? header[2] : undefined);

  if (header[3] === undefined && code === undefined && firstFrame < 0) {
    return unavailable([unreadable()]);
  }
  const location = reportedLocation(context, firstFrame < 0 ? [] : lines.slice(firstFrame, lastFrame + 1),
    workRoot);
  return nativeRecordFailureDiagnostic({ origin: NODE_TEST_STARTUP_FAILURE_ORIGIN, issues,
    records: [{ name: header[1], message: text, ...(code === undefined ? {} : { code }),
      ...(location === undefined ? {} : { location }),
      ...(properties.details.length === 0 ? {} : { details: properties.details }) }] });
}

export function nodeTestNativeReport({ workRoot }) {
  let previous = null;
  let beforePrevious = null;
  let caret = null;
  let block = null;
  let result = null;
  return {
    stream: "stdout",
    line(raw) {
      const text = raw.replace(SGR_RE, "").replace(/\r$/u, "");
      if (TERMINATOR_RE.test(text)) {
        result = block === null ? unavailable([unreadable()]) : reportDiagnosis(block, workRoot);
        block = null;
      } else if (caret !== null) {

        block = { context: caret.context, lines: text === "" ? [] : [text], overflow: false };
      } else if (block !== null) {
        if (block.lines.length < NODE_TEST_NATIVE_REPORT_BOUNDS.lines) block.lines.push(text);
        else block.overflow = true;
      }
      caret = CARET_RE.test(text) ? { context: beforePrevious } : null;
      beforePrevious = previous;
      previous = text;
    },
    finish() {
      return { startup_failure: result ?? (block === null ? null : unavailable([unreadable()])) };
    }
  };
}
