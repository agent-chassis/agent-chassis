

import { shouldExposeTool } from "./tool-profile.mjs";
import { guardToolHandler } from "./mcp-response.mjs";

const MAX_EFFECTS_UNWRAP_DEPTH = 32;

function isZodV3SchemaInstance(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value._def !== undefined &&
    value._zod === undefined
  );
}

function unwrapEffectsInputSchemaToZodObject(schema) {
  if (!isZodV3SchemaInstance(schema)) {
    return null;
  }
  let current = schema;
  let sawEffects = false;
  for (let depth = 0; depth < MAX_EFFECTS_UNWRAP_DEPTH; depth += 1) {
    const def = current?._def;
    if (!def) {
      return null;
    }
    if (def.typeName === "ZodEffects") {
      sawEffects = true;
      current = def.schema;
      continue;
    }
    break;
  }
  if (!sawEffects) {
    return null;
  }
  return current?._def?.typeName === "ZodObject" ? current : null;
}

function createEffectsEnforcingHandler(effectsSchema, downstreamHandler, name) {
  return async (args, extra) => {
    const parsed = await effectsSchema.safeParseAsync(args);
    if (!parsed.success) {
      throw new Error(
        `Input validation error: Invalid arguments for tool ${name}: ${parsed.error.message}`
      );
    }
    return downstreamHandler(parsed.data, extra);
  };
}

export function createRegisterTool({
  server,
  toolProfile,
  registeredTier,
  mcpToolTierRegistrationPolicy,
  toolUsageAuditBoundary,
  registeredToolNames,
  structuredLog
}) {
  return function registerTool(name, config, handler) {

    if (!shouldExposeTool(toolProfile, name)) {
      return;
    }

    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.descriptorLoaded === true &&
      !mcpToolTierRegistrationPolicy.freeLocalToolNames?.has(name)
    ) {
      return;
    }
    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames instanceof Set &&
      !mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames.has(name)
    ) {
      return;
    }

    const innerObjectSchema = unwrapEffectsInputSchemaToZodObject(config?.inputSchema);
    const effectiveConfig = innerObjectSchema
      ? { ...config, inputSchema: innerObjectSchema }
      : config;
    const auditedHandler = toolUsageAuditBoundary.wrapHandler(name, handler);
    const registrationHandler = innerObjectSchema
      ? createEffectsEnforcingHandler(config.inputSchema, auditedHandler, name)
      : auditedHandler;
    server.registerTool(name, effectiveConfig, guardToolHandler(registrationHandler, { name, log: structuredLog }));
    registeredToolNames.add(name);
  };
}
