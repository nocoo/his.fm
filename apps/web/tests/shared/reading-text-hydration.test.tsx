// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingText } from '../../src/shared/ReadingText';

describe('ReadingText SSR hydration', () => {
  let container: HTMLDivElement;
  const hydrationWarnings: unknown[][] = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = String(args[0] ?? '');
      if (/hydrat/i.test(message)) hydrationWarnings.push(args);
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    hydrationWarnings.length = 0;
  });

  it('hydrates speaker-labelled summaries without mismatch', () => {
    const text = '**主播：** 问题。';
    const markup = renderToString(<ReadingText text={text} />);
    container.innerHTML = markup;
    expect(markup).toContain('studio-transcript-block');
    expect(markup).toContain('id="');

    act(() => {
      hydrateRoot(container, <ReadingText text={text} />);
    });

    expect(hydrationWarnings).toEqual([]);
    expect(container.querySelector('.studio-transcript-block-label')?.textContent).toBe('主播');
  });
});
