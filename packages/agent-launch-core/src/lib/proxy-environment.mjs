

export const PROXY_ENVIRONMENT_NAMES = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
]);

const NO_PROXY_NAMES = Object.freeze(["NO_PROXY", "no_proxy"]);

export function projectProxyEnvironment(env) {
  const projected = {};
  for (const name of PROXY_ENVIRONMENT_NAMES) {
    if (typeof env?.[name] === "string") projected[name] = env[name];
  }
  return Object.freeze(projected);
}

function appendBypassHost(list, host) {
  if (list.split(",").some((entry) => entry.trim() === host)) return list;
  return list.length === 0 ? host : `${list},${host}`;
}

export function withRoutedClientGatewayBypass(env, gatewayHost) {
  if (typeof gatewayHost !== "string" || gatewayHost.length === 0) {
    throw new Error("a routed client's gateway bypass requires the gateway host");
  }
  const client = { ...env };
  const supplied = NO_PROXY_NAMES.filter((name) => typeof client[name] === "string");
  for (const name of supplied.length === 0 ? NO_PROXY_NAMES : supplied) {
    client[name] = appendBypassHost(client[name] ?? "", gatewayHost);
  }
  return client;
}
