import { defaultPrompts } from '@his-fm/contracts/prompt-defaults';
import { expect, it } from 'vitest';
import { executionEnvironment, networkContext } from './network.ts';

it('inherits only basic runtime and explicit proxy configuration', () => {
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/test',
    TMPDIR: '/tmp',
    LANG: 'en_US.UTF-8',
    SHELL: '/bin/sh',
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost,127.0.0.1',
    http_proxy: 'http://127.0.0.1:7891',
    https_proxy: 'http://127.0.0.1:7891',
    no_proxy: 'localhost',
    NODE_USE_ENV_PROXY: '1',
    GEMINI_API_KEY: 'secret',
    ELEVENLABS_API_KEY: 'secret',
    NODE_OPTIONS: '--require=untrusted.js',
  };
  const { GEMINI_API_KEY: _gemini, ELEVENLABS_API_KEY: _eleven, NODE_OPTIONS: _node, ...expected } = source;
  expect(executionEnvironment(source)).toEqual(expected);
  expect(executionEnvironment({})).toEqual({});
});

it('gives children credential-free endpoints and honest proxy state', () => {
  const state = networkContext(defaultPrompts.network, {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://user:proxy-secret@127.0.0.1:7891/private?token=hidden',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost,127.0.0.1',
    NODE_USE_ENV_PROXY: '1',
  });
  expect(state).toMatchObject({
    httpProxy: 'http://127.0.0.1:7891',
    httpsProxy: 'http://127.0.0.1:7890',
    nodeEnvProxyEnabled: true,
  });
  expect(state.inheritedVariables).toContain('NO_PROXY');
  expect(state.guidance).toContain('语音工具自动继承');
  expect(JSON.stringify(state)).not.toMatch(/proxy-secret|private|hidden|user:/);
  expect(networkContext(defaultPrompts.network, {})).toMatchObject({
    httpProxy: null,
    httpsProxy: null,
    nodeEnvProxyEnabled: false,
    inheritedVariables: [],
  });
  expect(networkContext(defaultPrompts.network, { https_proxy: 'invalid proxy' }).httpsProxy).toBe(
    'Configured proxy URL is invalid',
  );
});
