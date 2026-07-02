

import { EventEmitter } from "node:events";

import {
  AGY_APP_ID
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-agy-executor.mjs";

const SAMPLE_INPUT = Object.freeze({
  caller_session_id: "session-A",
  role: "worker",
  subject: "WK-0556#agy-production-executor-core",
  workspace_alias: "default",
  workspace_dir: "/tmp/fake-repo",
  readiness: { dispatchable: true },
  run_id: "wkdb_test_agy",
  monitor_handle: "wkmh_test_agy",
  app: AGY_APP_ID
});

function makeFakeChild({ pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal = "SIGTERM") => {
    child.killCalls.push(signal);
    child.emit("exit", null, signal);
    child.emit("close", null, signal);
  };
  child.finish = ({ code = 0, signal = null, stdout = "", stderr = "" } = {}) => {
    if (stdout.length > 0) child.stdout.emit("data", stdout);
    if (stderr.length > 0) child.stderr.emit("data", stderr);
    child.emit("exit", code, signal);
    child.emit("close", code, signal);
  };
  child.crash = (err) => child.emit("error", err);
  return child;
}

export { SAMPLE_INPUT, makeFakeChild };
