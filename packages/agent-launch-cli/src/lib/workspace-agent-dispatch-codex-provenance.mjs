import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision,
  describeDispatchArtifactReference
} from "./workspace-agent-dispatch-provenance.mjs";
import {
  codexTransportSecretEnvVars
} from "./workspace-agent-codex-final-result.mjs";

export async function buildCodexChildRunProvenance({
  finalPath,
  logPath,
  env,
  enforcement = null,
  sandboxDecision = null
}) {

  const effectiveEnforcement = sandboxDecision
    ? createDispatchProvenanceEnforcementFromSandboxDecision(sandboxDecision)
    : enforcement;
  const transportSecrets = codexTransportSecretEnvVars()
    .map((name) => (env && typeof env === "object" ? env[name] : null))
    .filter((value) => typeof value === "string" && value.length > 0);
  const artifacts = [];
  const finalRef = typeof finalPath === "string" && finalPath.length > 0
    ? await describeDispatchArtifactReference({
        kind: "final_response",
        path: finalPath,
        mediaType: "text/markdown",
        sensitivity: "routine",
        transportSecrets
      })
    : null;
  if (finalRef) artifacts.push(finalRef);
  const logRef = typeof logPath === "string" && logPath.length > 0
    ? await describeDispatchArtifactReference({
        kind: "session_log",
        path: logPath,
        mediaType: "text/plain",
        sensitivity: "sensitive",
        transportSecrets
      })
    : null;
  if (logRef) artifacts.push(logRef);
  const transcriptSource = logRef && logRef.exists
    ? "runtime_artifact"
    : finalRef && finalRef.exists
      ? "child_process_output_file"
      : "unavailable";
  return buildStructuredDispatchProvenance({ transcriptSource, enforcement: effectiveEnforcement, artifacts, transportSecrets });
}

export async function attachCodexChildRunProvenance(envelope, context) {
  if (!envelope || typeof envelope !== "object") {
    return envelope;
  }
  const provenance = await buildCodexChildRunProvenance(context);
  return { ...envelope, provenance };
}

export function attachProvenanceToSupervisedResult(supervised, provenanceContext) {
  if (!supervised || typeof supervised !== "object" || typeof supervised.probe !== "function") {
    return supervised;
  }
  const innerProbe = supervised.probe;
  return {
    ...supervised,
    probe: async () => {
      const probed = await innerProbe();
      if (
        probed &&
        typeof probed === "object" &&
        probed.final_result &&
        typeof probed.final_result === "object"
      ) {
        return {
          ...probed,
          final_result: await attachCodexChildRunProvenance(probed.final_result, provenanceContext)
        };
      }
      return probed;
    }
  };
}

export function captureCodexFinalResultFromPlan(captureFinalResult) {
  return async function codexParseFinalResult({ status, exit, plan, stdout, stderr }) {
    const finalPath = typeof plan?.finalPath === "string" && plan.finalPath.length > 0
      ? plan.finalPath
      : null;
    const logPath = typeof plan?.logPath === "string" && plan.logPath.length > 0
      ? plan.logPath
      : null;
    const envelope = await captureFinalResult({
      status,
      exit,
      finalPath,
      role: plan?.role ?? null,
      codexRole: plan?.role ?? null,
      subject: plan?.subject ?? null,
      stderr,
      env: plan?.env
    });
    return attachCodexChildRunProvenance(envelope, { finalPath, logPath, env: plan?.env });
  };
}
