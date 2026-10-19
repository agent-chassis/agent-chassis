import { createOpenCodeSchemaRequestMessageId, decodeOpenCodeSchemaResponse, decodeOpenCodeSchemaUsageParts,
  openCodeSchemaError, requestOpenCodeSchemaApi }
  from "./workspace-agent-opencode-schema-protocol.mjs";
import { isOpenCodeNativeSessionId } from "./workspace-agent-opencode-final-result.mjs";

export function createOpenCodeSchemaSession({ directory, password, prompt,
  readinessTimeoutMs = 30_000, requestTimeoutMs = 30_000, runTimeoutMs, usageTap = null }) {
  const state = { result: null, error: null, usageError: null, teardownRequested: false, work: null,
    phase: "readiness", nativeSessionId: null, requestMessageId: null };
  function start({ child, supervised }) {
    const controller = new AbortController();
    const abort = reason => { if (!controller.signal.aborted) controller.abort(reason); };

    void supervised.completion.then(() => abort(openCodeSchemaError(
      "opencode_schema_service_exited", "OpenCode service terminated during native session work")));
    const timer = setTimeout(() => abort(openCodeSchemaError(
      "opencode_schema_timeout", "OpenCode native schema session exceeded its run budget")), runTimeoutMs);
    let collectUsage = null;
    state.work = (async () => {
      try {
        const endpoint = await new Promise((resolve, reject) => {
          let text = "";
          const finish = (error, value) => {
            clearTimeout(readyTimer);
            child.stdout?.removeListener("data", onData);
            controller.signal.removeEventListener("abort", onAbort);
            if (error) reject(error); else resolve(value);
          };
          const onAbort = () => finish(controller.signal.reason);
          const onData = chunk => {
            text += chunk.toString("utf8");
            if (Buffer.byteLength(text) > 16_384) return finish(openCodeSchemaError(
              "opencode_schema_readiness_invalid", "OpenCode service readiness exceeded its capture bound"));
            const match = text.match(/(?:^|\n)opencode server listening on (http:\/\/127\.0\.0\.1:([0-9]+))\r?\n/u);
            if (match && Number(match[2]) > 0 && Number(match[2]) <= 65535) finish(null, match[1]);
          };
          const readyTimer = setTimeout(() => finish(openCodeSchemaError(
            "opencode_schema_readiness_timeout", "OpenCode service did not announce a loopback endpoint")), readinessTimeoutMs);
          child.stdout?.on("data", onData);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });
        const request = (route, options = {}) => requestOpenCodeSchemaApi({ endpoint, password, directory,
          route, signal: controller.signal, timeoutMs: requestTimeoutMs, ...options });
        state.phase = "health";
        const health = await request("/global/health");
        if (health.healthy !== true || health.version !== "1.19.3") throw openCodeSchemaError(
          "opencode_schema_version_mismatch", "The native schema service must be OpenCode 1.19.3", { health });
        state.phase = "session";
        const session = await request("/session", { method: "POST", body: {} });
        if (!isOpenCodeNativeSessionId(session.id) || session.directory !== directory) throw openCodeSchemaError(
          "opencode_schema_session_invalid", "OpenCode did not create a fresh session in the assigned directory");
        state.nativeSessionId = session.id;
        if (usageTap !== null) collectUsage = async () => {
          let complete = false;
          try {
            usageTap.bindNativeSession(session.id, { clientVersion: health.version });
            const messages = await request(`/session/${session.id}/message`);
            const parts = decodeOpenCodeSchemaUsageParts(messages, session.id);
            for (const part of parts) usageTap.observeNativePart(part);
            complete = true;
          } catch (error) { state.usageError = error; }
          finally {
            try { usageTap.endNativeUsage({ complete }); }
            catch (error) { state.usageError = error; }
          }
        };
        const messageId = createOpenCodeSchemaRequestMessageId();
        state.requestMessageId = messageId;
        state.phase = "prompt";
        const response = await request(`/session/${session.id}/message`, { method: "POST",
          body: { ...prompt, messageID: messageId }, timeoutMs: runTimeoutMs });
        state.result = decodeOpenCodeSchemaResponse(response, { sessionId: session.id, messageId, directory, prompt });
        state.phase = "completed";
      } catch (error) { state.error = error; }
      finally {

        if (collectUsage !== null) await collectUsage();
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {

          const terminate = signal => {
            try { return child.kill(signal) === true; }
            catch (error) {
              state.error = openCodeSchemaError("opencode_schema_teardown_failed",
                `OpenCode service ${signal} failed: ${error.message}`, {
                  session_error: state.error?.message ?? null });
              return false;
            }
          };
          state.teardownRequested = terminate("SIGTERM") && !controller.signal.aborted;
          const escalation = setTimeout(() => terminate("SIGKILL"), 2_000);
          escalation.unref();
          void supervised.completion.then(() => clearTimeout(escalation));
        }
      }
    })();
  }
  return { state, start };
}
