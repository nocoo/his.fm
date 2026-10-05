const proxyKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
];

export function executionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SHELL', ...proxyKeys]) {
    if (source[key]) environment[key] = source[key];
  }
  return environment;
}

export function networkContext(source: NodeJS.ProcessEnv = process.env) {
  const origin = (value: string | undefined) => {
    if (!value) return null;
    try {
      return new URL(value).origin;
    } catch {
      return 'Configured proxy URL is invalid';
    }
  };
  return {
    httpProxy: origin(source.http_proxy || source.HTTP_PROXY),
    httpsProxy: origin(source.https_proxy || source.HTTPS_PROXY),
    nodeEnvProxyEnabled: source.NODE_USE_ENV_PROXY === '1',
    inheritedVariables: proxyKeys.filter((key) => Boolean(source[key])),
    guidance:
      'Use the configured proxy for external requests and preserve NO_PROXY for loopback website/model/Jev traffic. Speech tools inherit these settings automatically. Native CLI executors must preserve them when spawning processes; Node fetch requires NODE_USE_ENV_PROXY=1 on a supporting runtime. A configured proxy is not proof of reachability: report connection failures rather than repeating paid requests. Never expose proxy credentials, change system networking or disable TLS verification.',
  };
}
