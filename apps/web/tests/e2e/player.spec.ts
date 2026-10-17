import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import type { BumperRecord } from '../../src/shared/production';
import { siteSeoSchema } from '../../src/shared/seo';

function silentWav(seconds: number) {
  const sampleRate = 8000;
  const bytes = seconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF');
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

const recordings = new Map([
  ['/media/player-first.wav', silentWav(90)],
  ['/media/player-second.wav', silentWav(45)],
]);
const cover = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
const episodes: Episode[] = [
  ['first', '播放器交互测试'],
  ['second', '另一段测试音频'],
].map(([id, title], index) => ({
  id,
  version: 1,
  slug: `player-${id}`,
  episodeNumber: index + 1,
  title,
  summary: '这是一段用于验证播放器交互的静音测试音频。',
  transcript: '播放器测试文稿。',
  showNotes: '播放器测试摘要。',
  coverUrl: '/images/player-test.png',
  category: 'test-category',
  tags: ['测试'],
  mentions: [],
  seo: {},
  durationSeconds: index ? 45 : 90,
  audioUrl: `/media/player-${id}.wav`,
  status: 'published',
  featured: !index,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}));

const bumpers: BumperRecord[] = episodes.map((episode, index) => ({
  id: episode.id,
  version: 1,
  name: episode.title,
  key: `player-${index}.wav`,
  url: episode.audioUrl as string,
  durationSeconds: episode.durationSeconds,
  size: 1024,
  position: index ? 'outro' : 'intro',
}));

async function fulfillAudio(route: Route, body: Buffer) {
  const range = route.request().headers().range;
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store',
  };
  if (!range) return route.fulfill({ status: 200, headers, body });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, body.length - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
  if (!match || start > end || start >= body.length)
    return route.fulfill({ status: 416, headers: { ...headers, 'Content-Range': `bytes */${body.length}` } });
  const slice = body.subarray(start, end + 1);
  return route.fulfill({
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${body.length}`,
      'Content-Length': String(slice.length),
    },
    body: slice,
  });
}

async function mockPlayer(page: Page) {
  const writes: string[] = [];
  let failed = false;
  let releaseMedia: (() => void) | undefined;
  let mediaGate: Promise<void> | undefined;
  await page.route('**/api/**', async (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(route.request().url());
      return route.abort();
    }
    switch (new URL(route.request().url()).pathname) {
      case '/admin/api/session':
        return route.fulfill({ json: { mode: 'local', user: { email: 'player-test@example.invalid' } } });
      case '/admin/api/bumpers':
        return route.fulfill({ json: { bumpers } });
      case '/admin/api/storage':
        return route.fulfill({
          json: {
            objects: [
              {
                key: 'player-first.wav',
                version: 'test-v1',
                size: recordings.get('/media/player-first.wav')?.length,
                uploaded: '2026-01-01T00:00:00Z',
                contentType: 'audio/wav',
                kind: 'audio',
                state: 'referenced',
                reasons: ['Test fixture'],
              },
            ],
            cursor: null,
          },
        });
      case '/admin/api/storage/object': {
        if (mediaGate) await mediaGate;
        if (failed) return route.fulfill({ status: 404, body: 'Missing test audio' });
        const body = recordings.get('/media/player-first.wav');
        if (!body) throw new Error('Missing test recording');
        return fulfillAudio(route, body);
      }
      case '/api/episodes':
        return route.fulfill({
          json: {
            episodes: episodes.map((episode) =>
              projectPublicEpisode(episode, new URL(route.request().url()).origin),
            ),
          },
        });
      case '/api/site-seo':
        return route.fulfill({ json: { seo: siteSeoSchema.parse({}) } });
      case '/api/categories':
        return route.fulfill({
          json: {
            categories: [{ id: 'test-category', name: '测试栏目', icon: 'Headphones', color: 'lime' }],
          },
        });
      case '/api/appearance':
        return route.fulfill({ json: { appearance: { theme: 'interval' } } });
      default:
        return route.fulfill({ status: 404, json: { error: 'Unmocked API' } });
    }
  });
  await page.route('**/images/player-test.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: cover }),
  );
  await page.route('**/media/player-*.wav', async (route) => {
    if (mediaGate) await mediaGate;
    if (failed) return route.fulfill({ status: 404, body: 'Missing test audio' });
    const body = recordings.get(new URL(route.request().url()).pathname);
    if (!body) throw new Error('Unknown test recording');
    return fulfillAudio(route, body);
  });
  return {
    writes,
    fail: () => {
      failed = true;
    },
    recover: () => {
      failed = false;
    },
    hold: () => {
      mediaGate = new Promise<void>((resolve) => {
        releaseMedia = resolve;
      });
    },
    release: () => {
      releaseMedia?.();
      mediaGate = undefined;
    },
  };
}

const currentTime = (audio: Locator) => audio.evaluate((element: HTMLAudioElement) => element.currentTime);
async function nearTime(audio: Locator, target: number) {
  await expect.poll(async () => Math.abs((await currentTime(audio)) - target)).toBeLessThan(2);
}
async function ready(page: Page, seconds = 90) {
  const audio = page.locator('.his-audio-player audio');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBe(seconds);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.seekable.length))
    .toBeGreaterThan(0);
  await expect(page.getByRole('slider', { name: '播放进度（秒）' })).toBeEnabled();
  return audio;
}

for (const width of [1440, 393]) {
  test(`custom player supports real forward/backward pointer seeking and keyboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mockPlayer(page);
    await page.goto('/episodes/player-first?theme=interval');
    const player = page.getByRole('region', { name: '音频播放器：播放器交互测试' });
    const audio = await ready(page);
    await expect(audio).toBeHidden();
    await expect(audio).not.toHaveAttribute('controls');
    await expect(player).toBeVisible();
    const seek = player.locator('.his-audio-seek');
    await seek.scrollIntoViewIfNeeded();
    const box = await seek.boundingBox();
    if (!box) throw new Error('Seek control has no pointer target');
    const y = box.y + box.height / 2;
    await page.mouse.click(box.x + box.width * 0.25, y);
    await nearTime(audio, 22.5);
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 12 });
    await page.mouse.up();
    await nearTime(audio, 72);
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 12 });
    await page.mouse.up();
    await nearTime(audio, 18);
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 60, y + 30, { steps: 8 });
    await page.mouse.up();
    await nearTime(audio, 90);
    const slider = player.getByRole('slider', { name: '播放进度（秒）' });
    await slider.focus();
    await slider.press('Home');
    await nearTime(audio, 0);
    await slider.press('ArrowRight');
    await nearTime(audio, 1);
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
    await slider.press('End');
    await nearTime(audio, 90);
    await slider.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuenow', '89');
    await expect(player.locator('.his-audio-times')).toContainText('1:29');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await player.screenshot({ path: test.info().outputPath(`player-public-${width}.png`) });
    expect(state.writes).toEqual([]);
  });
}

test('play, pause, volume, mute and speed control the hidden media engine; covers never start image drags', async ({
  page,
}) => {
  const state = await mockPlayer(page);
  await page.goto('/episodes/player-first?theme=interval');
  const audio = await ready(page);
  const player = page.locator('.his-audio-player');
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await player.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await player.getByRole('button', { name: '静音', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.muted)).toBe(true);
  await player.getByRole('button', { name: '取消静音', exact: true }).click();
  const volume = player.getByRole('slider', { name: '音量（百分比）' });
  await volume.focus();
  await volume.press('Home');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume)).toBe(0);
  await volume.press('End');
  await volume.press('ArrowLeft');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume)).toBe(0.99);
  await player.getByRole('button', { name: /播放速度/ }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1.25);
  await expect(player.locator('.his-audio-cover .framed-cover-image')).toHaveAttribute('draggable', 'false');
  await page.evaluate(() => {
    document.addEventListener('dragstart', () =>
      document.documentElement.setAttribute('data-test-drag', 'started'),
    );
  });
  const coverBox = await player.locator('.his-audio-cover').boundingBox();
  if (!coverBox) throw new Error('Cover has no bounds');
  await page.mouse.move(coverBox.x + 25, coverBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(coverBox.x + 120, coverBox.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('html')).not.toHaveAttribute('data-test-drag');
  expect(state.writes).toEqual([]);
});

test('loading and media errors stay actionable, and retry reloads only the mock audio', async ({ page }) => {
  const state = await mockPlayer(page);
  state.hold();
  await page.goto('/episodes/player-first?theme=interval', { waitUntil: 'domcontentloaded' });
  const player = page.locator('.his-audio-player');
  try {
    await expect(player).toHaveAttribute('data-state', 'loading');
    await expect(player.getByRole('status')).toContainText('正在加载音频');
    await expect(player.getByRole('slider', { name: '播放进度（秒）' })).toBeDisabled();
  } finally {
    state.release();
  }
  await ready(page);
  state.fail();
  await page.reload();
  await expect(player.getByRole('alert')).toContainText('音频不存在');
  await expect(player.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
  await expect(player.getByRole('button', { name: '重试', exact: true })).toBeEnabled();
  state.recover();
  await player.getByRole('button', { name: '重试', exact: true }).click();
  await ready(page);
  await expect(player.getByRole('alert')).toHaveCount(0);
  await expect(player.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  expect(state.writes).toEqual([]);
});

test('a source change stops the previous recording and resets position, duration and playback settings', async ({
  page,
}) => {
  const state = await mockPlayer(page);
  await page.goto('/episodes/player-first?theme=interval');
  await ready(page);
  const player = page.locator('.his-audio-player');
  const slider = player.getByRole('slider', { name: '播放进度（秒）' });
  await slider.focus();
  await slider.press('End');
  await slider.press('ArrowLeft');
  await player.getByRole('button', { name: /播放速度/ }).click();
  await player.getByRole('button', { name: '静音', exact: true }).click();
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await page.evaluate(() => Reflect.set(window, '__previousTestAudio', document.querySelector('audio')));
  await page.getByRole('link', { name: '另一段测试音频', exact: true }).click();
  await expect(page).toHaveURL(/\/episodes\/test-category\/player-second\?theme=interval$/);
  const audio = await ready(page, 45);
  await expect(page.locator('.his-audio-player')).toHaveCount(1);
  expect(
    await audio.evaluate((element: HTMLAudioElement) => ({
      time: element.currentTime,
      paused: element.paused,
      speed: element.playbackRate,
      muted: element.muted,
    })),
  ).toEqual({ time: 0, paused: true, speed: 1, muted: false });
  expect(
    await page.evaluate(() => (Reflect.get(window, '__previousTestAudio') as HTMLAudioElement).paused),
  ).toBe(true);
  await expect(player.locator('.his-audio-times')).toContainText('0:45');
  expect(state.writes).toEqual([]);
});

test.describe('touch interaction', () => {
  test.use({ hasTouch: true });

  test('touch seek captures movement and recovers cleanly after pointer cancellation', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const state = await mockPlayer(page);
    await page.goto('/episodes/player-first?theme=interval');
    const audio = await ready(page);
    const seek = page.locator('.his-audio-seek');
    await seek.scrollIntoViewIfNeeded();
    const box = await seek.boundingBox();
    if (!box) throw new Error('Seek control has no touch target');
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width * 0.2, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: box.x + box.width * 0.75, y }],
    });
    await nearTime(audio, 67.5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.touchscreen.tap(box.x + box.width * 0.3, y);
    await nearTime(audio, 27);
    await audio.evaluate((element: HTMLAudioElement) => {
      element.currentTime = 5;
    });
    await expect(page.getByRole('slider', { name: '播放进度（秒）' })).toHaveAttribute('aria-valuenow', '5');
    await cdp.detach();
    expect(state.writes).toEqual([]);
  });
});

test('admin compact previews share controls, never overlap playback and fit a phone in both themes', async ({
  page,
}) => {
  const state = await mockPlayer(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/admin/bumpers');
  const players = page.locator('.his-audio-player');
  await expect(players).toHaveCount(2);
  await expect(players.first()).toHaveClass(/is-compact/);
  await expect(players.first()).toHaveAttribute('data-state', 'paused');
  await players.first().getByRole('button', { name: '播放', exact: true }).click();
  await expect
    .poll(() =>
      players
        .first()
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.paused),
    )
    .toBe(false);
  await players.nth(1).getByRole('button', { name: '播放', exact: true }).click();
  await expect
    .poll(() =>
      players
        .nth(1)
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.paused),
    )
    .toBe(false);
  await expect
    .poll(() =>
      players
        .first()
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.paused),
    )
    .toBe(true);
  await expect(players.first().getByRole('button', { name: '播放', exact: true })).toBeVisible();
  for (const dark of [false, true]) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value);
      document.documentElement.classList.toggle('light', !value);
    }, dark);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await players.first().boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(393);
    await expect(players.first().getByRole('slider', { name: '播放进度（秒）' })).toBeVisible();
    await players.first().screenshot({
      path: test.info().outputPath(`player-admin-${dark ? 'dark' : 'light'}-393.png`),
    });
  }
  expect(state.writes).toEqual([]);
});

test('admin resource preview uses the same custom seek and error/retry controls', async ({ page }) => {
  const state = await mockPlayer(page);
  await page.goto('/admin/storage');
  await page.getByRole('button', { name: '预览 player-first.wav', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '资源预览' });
  await expect(dialog.locator('.his-audio-player')).toBeVisible();
  const audio = await ready(page);
  const seek = dialog.locator('.his-audio-seek');
  const box = await seek.boundingBox();
  if (!box) throw new Error('Preview seek control has no pointer target');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await nearTime(audio, 45);
  await page.keyboard.press('Escape');
  state.fail();
  await page.getByRole('button', { name: '预览 player-first.wav', exact: true }).click();
  await expect(dialog.locator('.his-audio-player').getByRole('alert')).toContainText('音频不存在');
  state.recover();
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await ready(page);
  expect(state.writes).toEqual([]);
});
