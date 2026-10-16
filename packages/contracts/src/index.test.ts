import { describe, expect, it } from 'vitest';
import * as contracts from './index.ts';

describe('contracts index', () => {
  it('re-exports audio and scope helpers', () => {
    expect(contracts.parseMp3).toBeTypeOf('function');
    expect(contracts.parseWav).toBeTypeOf('function');
    expect(contracts.hasScope).toBeTypeOf('function');
  });
});
