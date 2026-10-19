import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertTarballIntegrity } from '../../../../scripts/lockfile-tarball.mjs';

describe('lockfile tarball integrity', () => {
  it('accepts a buffer matching the lockfile sha512', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    assertTarballIntegrity(body, `sha512-${digest}`);
  });

  it('rejects a tampered tarball', () => {
    const body = Buffer.from('verified package bytes');
    const digest = createHash('sha512').update(body).digest('base64');
    const tampered = Buffer.from('tampered package bytes');
    expect(() => assertTarballIntegrity(tampered, `sha512-${digest}`)).toThrow(/integrity check failed/i);
  });

  it('rejects missing integrity metadata', () => {
    expect(() => assertTarballIntegrity(Buffer.from('x'), '')).toThrow(/missing integrity/i);
  });
});
