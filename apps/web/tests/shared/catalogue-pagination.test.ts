import { describe, expect, it } from 'vitest';
import {
  catalogueCanonical,
  cataloguePageCount,
  cataloguePageHref,
  cataloguePaginationLinks,
  paginateList,
  parseCataloguePage,
} from '../../src/shared/catalogue-pagination';

describe('catalogue pagination', () => {
  it('parses page numbers and slices lists', () => {
    expect(parseCataloguePage(null)).toBe(1);
    expect(parseCataloguePage('0')).toBe(1);
    expect(parseCataloguePage('abc')).toBe(1);
    expect(parseCataloguePage('2')).toBe(2);
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    expect(paginateList(items, 1)).toHaveLength(20);
    expect(paginateList(items, 2)).toEqual([21, 22, 23, 24, 25]);
    expect(cataloguePageCount(25)).toBe(2);
  });

  it('builds canonical URLs without page one', () => {
    expect(catalogueCanonical('https://his.fm', 'learning', 1, 20, 25)).toBe(
      'https://his.fm/episodes?category=learning',
    );
    expect(catalogueCanonical('https://his.fm', 'learning', 2, 20, 25)).toBe(
      'https://his.fm/episodes?category=learning&page=2',
    );
  });

  it('emits prev and next link tags for multi-page columns', () => {
    expect(cataloguePaginationLinks('https://his.fm', 'learning', 1, 10)).toEqual([]);
    expect(cataloguePaginationLinks('https://his.fm', 'learning', 1, 25)).toEqual([
      '<link rel="next" href="https://his.fm/episodes?category=learning&page=2" />',
    ]);
    expect(cataloguePaginationLinks('https://his.fm', 'learning', 2, 25)).toEqual([
      '<link rel="prev" href="https://his.fm/episodes?category=learning" />',
    ]);
    expect(cataloguePaginationLinks('https://his.fm', 'learning', 2, 45)).toEqual([
      '<link rel="prev" href="https://his.fm/episodes?category=learning" />',
      '<link rel="next" href="https://his.fm/episodes?category=learning&page=3" />',
    ]);
    expect(cataloguePaginationLinks('https://his.fm', 'learning', 3, 45)).toEqual([
      '<link rel="prev" href="https://his.fm/episodes?category=learning&page=2" />',
    ]);
  });

  it('builds list hrefs for all and paged columns', () => {
    expect(cataloguePageHref(null, 1)).toBe('/episodes');
    expect(cataloguePageHref('all', 1)).toBe('/episodes');
    expect(cataloguePageHref('learning', 1)).toBe('/episodes?category=learning');
    expect(cataloguePageHref('learning', 2)).toBe('/episodes?category=learning&page=2');
  });
});
