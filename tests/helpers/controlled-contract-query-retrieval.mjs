

import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

import { measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { selectedResponseDeliveryBound } from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";

export const QUERY_TOOL = "workspace_controlled_contract_obligation_coverage_query";

const value = (result) => {
  assert.notEqual(result.isError, true, JSON.stringify(result).slice(0, 4000));
  return result.structuredContent;
};

const utf8 = (value_) => Buffer.byteLength(JSON.stringify(value_), "utf8");

export function queryJourney(session) {
  const bound = selectedResponseDeliveryBound(session.responseEnv);
  const ledger = { calls: 0, request_bytes: 0, result_bytes: 0, largest_frame: 0 };
  const call = async (args) => {
    const request = { name: QUERY_TOOL, arguments: args };
    const result = await session.callTool(request);
    ledger.calls += 1;
    ledger.request_bytes += utf8(request);
    ledger.result_bytes += utf8(result);
    if (result.isError !== true) {
      const frame = measureMcpInlineResultBytes(result.structuredContent);
      ledger.largest_frame = Math.max(ledger.largest_frame, frame);
      assert.ok(frame <= bound, `query frame ${frame} exceeds the ${bound}-byte bound`);
    }
    return result;
  };
  const total = () => ({ ...ledger, total_bytes: ledger.request_bytes + ledger.result_bytes });
  return { call, ledger, total, bound };
}

const ROW_PROJECTION = "task-result-row-projection.v1";

const continuationOf = (response, fieldPath) => response.next_calls.find((call) =>
  isDeepStrictEqual(call.arguments.detail.field_path, fieldPath));

async function readField(journey, template, fieldPath) {
  return (await readQueryField(journey, { ...template,
    detail: { ...template.detail, field_path: fieldPath } })).value;
}

export async function readQueryField(journey, args) {
  const fieldPath = args.detail.field_path;
  let response = value(await journey.call(args));
  let page = response.page;
  if (page.value_kind === "undefined") return { value: undefined, response };
  if (page.complete === true && Object.hasOwn(page, "value")) return { value: page.value, response };
  if (page.range_required === true || Object.hasOwn(page, "value_base64")) {
    const chunks = [];
    if (Object.hasOwn(page, "value_base64")) chunks.push(Buffer.from(page.value_base64, "base64"));
    for (let next = continuationOf(response, fieldPath); next !== undefined; next = continuationOf(response, fieldPath)) {
      response = value(await journey.call(next.arguments));
      chunks.push(Buffer.from(response.page.value_base64, "base64"));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return { value: page.value_kind === "string" ? text : JSON.parse(text), response };
  }
  assert.ok(Array.isArray(page.fields), JSON.stringify(page).slice(0, 2000));
  const assembled = page.value_kind === "array" ? [] : {};
  for (;;) {
    for (const field of page.fields) {
      assembled[field.path.at(-1)] = await readField(journey, response.descend.arguments, field.path);
    }
    const next = continuationOf(response, fieldPath);
    if (next === undefined) break;
    response = value(await journey.call(next.arguments));
    page = response.page;
  }
  return { value: assembled, response };
}

export async function retrieveQuery(journey, args) {
  return assembleQuery(journey, value(await journey.call(args)));
}

export async function assembleQuery(journey, first) {
  if (first.selected_detail?.complete === true) {
    const { selected_detail: _detail, ...carrier } = first;
    return { carrier, first };
  }
  const members = {};
  const collections = {};
  let response = first;
  if (first.schema_version !== "selected-response-detail.v1") {
    for (const [key, member] of Object.entries(first)) {
      if (!["selected_detail", "next_calls", "parameter_selection", "criterion_identities"].includes(key)) {
        members[key] = member;
      }
    }
    for (const [collection, count] of Object.entries(first.selected_detail.collections)) {
      if (collection !== "members" && count >= 0) collections[collection] = [];
    }

    const start = first.next_calls.find((call) => call.arguments.detail.field_path === undefined);
    if (start === undefined) return { carrier: { ...members, ...collections }, first };
    response = value(await journey.call(start.arguments));
  }
  for (;;) {
    const page = response.page;
    for (const item of page.items) {
      const projected = item.schema_version === ROW_PROJECTION;
      const row = projected ? { id: item.stable_id,
        value: await readField(journey, response.descend.arguments, ["value"]) } : item;
      if (page.collection === "members") {
        if (Object.hasOwn(row, "collection")) collections[row.id] ??= [];
        else members[row.id] = row.value;
      } else {
        collections[page.collection] ??= [];
        assert.equal(row.id, String(collections[page.collection].length),
          "collection rows arrive once, in canonical order");
        collections[page.collection].push(row.value);
      }
    }
    if (response.next_calls.length === 0) break;
    response = value(await journey.call(response.next_calls[0].arguments));
  }
  return { carrier: { ...members, ...collections }, first };
}

export async function readParameterSelection(journey, first) {
  const fields = {};
  const nextField = (response, fieldPath) => response.next_calls.find((call) =>
    Array.isArray(call.arguments.detail.field_path) &&
    !isDeepStrictEqual(call.arguments.detail.field_path, fieldPath));
  let call = nextField(first, undefined);
  while (call !== undefined) {
    const fieldPath = call.arguments.detail.field_path;
    const read = await readQueryField(journey, call.arguments);
    fields[fieldPath.slice(fieldPath[1] === "parameter_contract" ? 2 : 1).join(".")] = read.value;
    call = nextField(read.response, fieldPath);
  }
  return fields;
}

export function composeParameterContract(selection, fields) {
  const slots = Object.keys(fields).filter((key) => key.startsWith("parameters."));
  const members = Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith("parameters.")));
  return { ...selection.parameter_contract_identity, ...members,
    parameters: selection.parameters ?? slots.map((_, index) => fields[`parameters.${index}`]) };
}
