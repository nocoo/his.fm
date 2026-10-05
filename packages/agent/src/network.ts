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

export function networkContext(guidance: string, source: NodeJS.ProcessEnv = process.env) {
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
    guidance,
  };
}
