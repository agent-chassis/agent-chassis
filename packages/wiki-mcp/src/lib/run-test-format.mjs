
import { measureMcpInlineResultBytes } from './mcp-response.mjs';
export const RUN_TEST_RESPONSE_MAX_BYTES = 1024;
const FIXED_FACT_MAX_BYTES = 64;
const fits = (payload, isError) => measureMcpInlineResultBytes(payload, { isError }) <= RUN_TEST_RESPONSE_MAX_BYTES;

function utf8Tail(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let start = bytes.length - limit;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function utf8HeadLength(bytes, limit) {
  if (bytes.length <= limit) return bytes.length;
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

function largestFitting(high, build, isError) {
  if (!fits(build(0), isError)) return -1;
  if (fits(build(high), isError)) return high;
  let low = 0;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(build(middle), isError)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function clippedHead(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  return bytes.subarray(0, utf8HeadLength(bytes, limit)).toString("utf8");
}

export function fitPayload({ heads = {}, tails = {}, assemble, isError = false }) {
  const clip = (texts, cut, cap) => Object.fromEntries(Object.entries(texts)
    .map(([key, text]) => [key, cut(text, cap)]));
  const longest = (texts) => Math.max(0, ...Object.values(texts).map((text) => Buffer.byteLength(text, "utf8")));
  const groups = Array.isArray(heads) ? heads : [heads];
  const noTails = clip(tails, utf8Tail, 0);
  let shownHeads = {};
  groups.forEach((group, at) => {
    const later = Object.assign({}, ...groups.slice(at + 1).map((next) => clip(next, clippedHead, 0)));
    const cap = largestFitting(longest(group),
      (tried) => assemble({ ...shownHeads, ...clip(group, clippedHead, tried), ...later }, noTails), isError);
    if (cap < 0) throw new RangeError(`workspace_run_test could not fit its essential facts in 1,024 bytes`);
    shownHeads = { ...shownHeads, ...clip(group, clippedHead, cap) };
  });
  const build = (cap) => assemble(shownHeads, clip(tails, utf8Tail, cap));
  return build(largestFitting(longest(tails), build, isError));
}

export const omitted = (full, shown) => Buffer.byteLength(full, 'utf8') - Buffer.byteLength(shown, 'utf8');
export const clippable = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') > FIXED_FACT_MAX_BYTES;
export const fitsRunTestResponse = fits;
