

import {
  normalizeObjectSchema,
  objectFromShape,
  safeParseAsync
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

export const REGISTERED_TOOL_REQUEST_CONTRACT_CODES = Object.freeze({
  CONFLICT: "registered_tool_request_contract_conflict",
  PROJECTION_UNAVAILABLE: "registered_tool_request_projection_unavailable"
});

const lookupsByRegistrar = new WeakMap();

const NO_ARGUMENT_REQUEST_SCHEMA = Object.freeze({ type: "object", properties: Object.freeze({}) });

function isZodLike(value) {
  return value !== null && typeof value === "object" &&
    (value._def !== undefined || value._zod !== undefined || typeof value.parse === "function");
}

function isRawShape(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    value._def === undefined && value._zod === undefined && typeof value.parse !== "function" &&
    Object.values(value).every(isZodLike);
}

async function parseWithOwnSchema(schema, args) {
  if (schema?._zod !== undefined) return safeParseAsync(schema, args);
  const parse = Object.getPrototypeOf(schema)?.safeParseAsync;
  if (typeof parse !== "function") throw new TypeError("request schema exposes no parser");
  return parse.call(schema, args);
}

function projectionUnavailable(toolName, cause) {
  const error = new TypeError(
    `${REGISTERED_TOOL_REQUEST_CONTRACT_CODES.PROJECTION_UNAVAILABLE}: ${toolName}`,
    cause === undefined ? undefined : { cause }
  );
  error.code = REGISTERED_TOOL_REQUEST_CONTRACT_CODES.PROJECTION_UNAVAILABLE;
  return error;
}

function createContract(toolName, { inputSchema, publishedInputSchema }) {
  const noArgument = publishedInputSchema === undefined;
  let sdkObject;
  let requestSchema = null;
  const publishedObject = () => {
    if (sdkObject === undefined) {
      sdkObject = isRawShape(publishedInputSchema)
        ? objectFromShape(publishedInputSchema)
        : normalizeObjectSchema(publishedInputSchema) ?? null;
    }
    return sdkObject;
  };
  const fullParser = () => (publishedInputSchema === inputSchema && isRawShape(inputSchema)
    ? publishedObject()
    : isRawShape(inputSchema) ? objectFromShape(inputSchema) : inputSchema);
  let parser;
  return Object.freeze({
    toolName,

    publishedRequestSchema() {
      if (requestSchema !== null) return requestSchema;
      if (noArgument) {
        requestSchema = NO_ARGUMENT_REQUEST_SCHEMA;
        return requestSchema;
      }
      const object = publishedObject();
      if (object === null) throw projectionUnavailable(toolName);
      try {
        requestSchema = toJsonSchemaCompat(object, { strictUnions: true, pipeStrategy: "input" });
      } catch (error) {
        throw projectionUnavailable(toolName, error);
      }
      return requestSchema;
    },

    async acceptsArguments(args) {
      if (inputSchema === undefined) {
        return args !== null && typeof args === "object" && !Array.isArray(args) &&
          Object.keys(args).length === 0;
      }
      parser ??= fullParser();
      const parsed = await parseWithOwnSchema(parser, args);
      return parsed?.success === true;
    }
  });
}

export function createRegisteredToolRequestContractStore() {
  const entries = new Map();
  const conflicted = new Set();

  function conflict(toolName) {
    entries.delete(toolName);
    conflicted.add(toolName);
    const error = new TypeError(
      `${REGISTERED_TOOL_REQUEST_CONTRACT_CODES.CONFLICT}: ${toolName} was registered with a different request contract`
    );
    error.code = REGISTERED_TOOL_REQUEST_CONTRACT_CODES.CONFLICT;
    return error;
  }

  const sameDeclaration = (entry, { inputSchema, advertisedInputSchema }) =>
    entry.inputSchema === inputSchema && entry.advertisedInputSchema === advertisedInputSchema;

  function assertRetainable(toolName, declaration) {
    if (conflicted.has(toolName)) throw conflict(toolName);
    const existing = entries.get(toolName);
    if (existing !== undefined && !sameDeclaration(existing, declaration)) throw conflict(toolName);
  }

  function retain(toolName, { inputSchema, advertisedInputSchema, publishedInputSchema }) {
    assertRetainable(toolName, { inputSchema, advertisedInputSchema });
    if (entries.has(toolName)) return;
    entries.set(toolName, Object.freeze({
      inputSchema,
      advertisedInputSchema,
      contract: createContract(toolName, { inputSchema, publishedInputSchema })
    }));
  }

  const lookup = Object.freeze({
    contractFor(toolName) {
      return entries.get(toolName)?.contract ?? null;
    }
  });

  return Object.freeze({ assertRetainable, retain, lookup });
}

export function bindRegisteredToolRequestContracts(registrar, store) {
  if (typeof registrar !== "function") {
    throw new TypeError("registered tool request contracts bind to a registrar function");
  }
  lookupsByRegistrar.set(registrar, store.lookup);
}

export function registeredToolRequestContracts(registrar) {
  return lookupsByRegistrar.get(registrar) ?? null;
}
