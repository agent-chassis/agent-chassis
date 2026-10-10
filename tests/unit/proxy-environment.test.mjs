

import assert from "node:assert/strict";
import test from "node:test";

import {
  PROXY_ENVIRONMENT_NAMES,
  projectProxyEnvironment,
  withRoutedClientGatewayBypass
} from "../../packages/agent-launch-core/src/lib/proxy-environment.mjs";

const EIGHT_NAMES = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy"
];

test("proxy projection preserves all eight case-specific string inputs", () => {
  assert.deepEqual([...PROXY_ENVIRONMENT_NAMES].sort(), [...EIGHT_NAMES].sort());
  assert.ok(Object.isFrozen(PROXY_ENVIRONMENT_NAMES));

  const supplied = {
    HTTP_PROXY: "http://user:p%40ss@upper.proxy.test:3128",
    HTTPS_PROXY: "",
    ALL_PROXY: "socks5h://upper.proxy.test:1080",
    NO_PROXY: " localhost , .internal.test,*",
    http_proxy: "http://lower.proxy.test:8080/",
    https_proxy: "HTTP://Lower.Proxy.Test:8443",
    all_proxy: "",
    no_proxy: ""
  };
  const env = { PATH: "/usr/bin", OPENAI_API_KEY: "sk-unrelated", Http_Proxy: "http://mixed.test", ...supplied };
  const before = structuredClone(env);
  const projected = projectProxyEnvironment(env);
  assert.deepEqual({ ...projected }, supplied);
  assert.deepEqual(env, before, "the caller object is not mutated");
  assert.ok(Object.isFrozen(projected));
  assert.notEqual(projected, env);

  for (const name of EIGHT_NAMES) {
    for (const value of ["http://only.test:1", ""]) {
      assert.deepEqual({ ...projectProxyEnvironment({ [name]: value, HOME: "/h" }) }, { [name]: value }, name);
    }
  }
  assert.deepEqual({ ...projectProxyEnvironment({ PATH: "/usr/bin" }) }, {});
  assert.deepEqual({ ...projectProxyEnvironment({}) }, {});
  assert.deepEqual({ ...projectProxyEnvironment(undefined) }, {});

  assert.deepEqual({ ...projectProxyEnvironment({ HTTP_PROXY: undefined, no_proxy: 0, NO_PROXY: "a" }) },
    { NO_PROXY: "a" });
});

test("a routed client's bypass appends the gateway host to supplied variants only", () => {
  const host = "127.0.0.1";
  const cases = [

    [{}, { NO_PROXY: host, no_proxy: host }],
    [{ NO_PROXY: "internal.test" }, { NO_PROXY: `internal.test,${host}` }],
    [{ no_proxy: "internal.test" }, { no_proxy: `internal.test,${host}` }],
    [{ NO_PROXY: "" }, { NO_PROXY: host }],
    [{ no_proxy: "" }, { no_proxy: host }],
    [{ NO_PROXY: "a.test, b.test", no_proxy: "" }, { NO_PROXY: `a.test, b.test,${host}`, no_proxy: host }],
    [{ NO_PROXY: "*" }, { NO_PROXY: `*,${host}` }],
    [{ NO_PROXY: `a.test, ${host} ,b.test` }, { NO_PROXY: `a.test, ${host} ,b.test` }],
    [{ NO_PROXY: `x${host}`, no_proxy: `${host}.example` },
      { NO_PROXY: `x${host},${host}`, no_proxy: `${host}.example,${host}` }]
  ];
  for (const [supplied, expected] of cases) {
    const env = { PATH: "/usr/bin", HTTP_PROXY: "http://proxy.test:3128", https_proxy: "", ...supplied };
    const before = structuredClone(env);
    const client = withRoutedClientGatewayBypass(env, host);
    assert.deepEqual(env, before, "the caller env is not mutated");
    assert.notEqual(client, env);
    assert.deepEqual(client, { PATH: "/usr/bin", HTTP_PROXY: "http://proxy.test:3128", https_proxy: "", ...expected },
      JSON.stringify(supplied));
    assert.deepEqual(withRoutedClientGatewayBypass(client, host), client, "the host is added once");
  }
  assert.throws(() => withRoutedClientGatewayBypass({}, ""), /gateway host/);
  assert.throws(() => withRoutedClientGatewayBypass({}, undefined), /gateway host/);
});
