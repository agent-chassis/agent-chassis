

import {
  HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS,
  isPlainObject
} from "./protocol-constants.mjs";

import {
  isSourceToolSurfaceNotConfigured
} from "../agent-child-tool-surface.mjs";

export function findForbiddenToken(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof serialized !== "string") return null;
  for (const token of HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS) {
    if (serialized.includes(token)) return token;
  }
  return null;
}

export function findForbiddenTokenInLaunchInput(value) {
  if (!isPlainObject(value) || !isPlainObject(value.source_tool_surface)) {
    return findForbiddenToken(value);
  }
  const surface = value.source_tool_surface;

  if (isSourceToolSurfaceNotConfigured(surface)) {
    return findForbiddenToken(value);
  }
  const descriptor = isPlainObject(surface.descriptor)
    ? surface.descriptor
    : null;
  const scanValue = {
    ...value,
    source_tool_surface: {
      ...surface,
      descriptor: descriptor
        ? {
            ...descriptor,

            disallowed_tools: []
          }
        : surface.descriptor
    }
  };
  return findForbiddenToken(scanValue);
}

export function findForbiddenTokenInResponseEnvelope(response) {
  if (!isPlainObject(response)) {
    return findForbiddenToken(response);
  }
  const { final_result: _observationalContent, refusal, ...transportFields } = response;
  const scanTarget = { ...transportFields };
  if (refusal !== undefined) {
    if (isPlainObject(refusal)) {
      const { detail: _refusalDiagnosticDetail, ...refusalTransportFields } = refusal;
      scanTarget.refusal = refusalTransportFields;
    } else {
      scanTarget.refusal = refusal;
    }
  }
  return findForbiddenToken(scanTarget);
}
