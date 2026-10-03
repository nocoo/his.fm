import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { AudioError, chunkTranscript, composeWav, readStoredWav, synthesizeSpeech } from './audio';
import { checkActiveAudio, getAudioSnapshot, setAudioState } from './audio-store';
import { HttpError } from './http';
import { getProduction, mediaUrl } from './production-store';

export class AudioWorkflow extends WorkflowEntrypoint<Env, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const snapshot = await step.do('load-approved-script', () =>
      getAudioSnapshot(this.env.DB, event.payload.jobId),
    );
    const existing = await getProduction(this.env.DB, snapshot.productionId);
    if (
      existing.audioJob?.id === snapshot.jobId &&
      existing.audioJob.status === 'complete' &&
      existing.assets.audio?.scriptVersion === snapshot.scriptVersion
    ) {
      return { key: existing.assets.audio.key, durationSeconds: existing.assets.audio.durationSeconds };
    }
    try {
      await step.do('start-audio', async () => {
        await checkActiveAudio(this.env, snapshot);
        await setAudioState(this.env, snapshot, 'running');
      });
      const chunks = chunkTranscript(snapshot.transcript);
      const prefix = `audio/${snapshot.productionId}/${snapshot.scriptVersion}/${snapshot.jobId}`;
      const keys: string[] = [];
      for (let index = 0; index < chunks.length; index++) {
        const key = await step.do(
          `narrate-${index + 1}`,
          { retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' }, timeout: '4 minutes' },
          async () => {
            try {
              await checkActiveAudio(this.env, snapshot);
              const key = `${prefix}/part-${String(index + 1).padStart(3, '0')}.wav`;
              if (await this.env.MEDIA.head(key)) return key;
              const generated = await synthesizeSpeech(
                this.env.GEMINI_API_KEY,
                chunks[index],
                snapshot.voice,
                snapshot.speakingStyle,
              );
              await this.env.MEDIA.put(key, generated.bytes, { httpMetadata: { contentType: 'audio/wav' } });
              return key;
            } catch (error) {
              if (error instanceof HttpError || (error instanceof AudioError && !error.retryable))
                throw new NonRetryableError(error.message);
              throw error;
            }
          },
        );
        keys.push(key);
      }
      let composed = await step.do(
        'assemble-narration',
        { retries: { limit: 2, delay: '5 seconds' }, timeout: '5 minutes' },
        async () => {
          await checkActiveAudio(this.env, snapshot);
          const key = `${prefix}/narration.wav`;
          if (await this.env.MEDIA.head(key)) {
            const stored = await readStoredWav(this.env.MEDIA, key);
            return { key, bytes: stored.size, durationSeconds: stored.durationSeconds };
          }
          return composeWav(this.env.MEDIA, keys, key);
        },
      );
      if (snapshot.introKey && snapshot.outroKey) {
        const parts = [snapshot.introKey, composed.key, snapshot.outroKey];
        composed = await step.do(
          'assemble-with-bumpers',
          { retries: { limit: 2, delay: '5 seconds' }, timeout: '5 minutes' },
          async () => {
            await checkActiveAudio(this.env, snapshot);
            const key = `${prefix}/final.wav`;
            if (await this.env.MEDIA.head(key)) {
              const stored = await readStoredWav(this.env.MEDIA, key);
              return { key, bytes: stored.size, durationSeconds: stored.durationSeconds };
            }
            return composeWav(this.env.MEDIA, parts, key);
          },
        );
      }
      await step.do('attach-approved-script-audio', async () => {
        await setAudioState(this.env, snapshot, 'complete', null, {
          key: composed.key,
          url: mediaUrl(this.env, composed.key),
          mimeType: 'audio/wav',
          voice: snapshot.voice,
          includesBumpers: Boolean(snapshot.introKey && snapshot.outroKey),
          size: composed.bytes,
          scriptVersion: snapshot.scriptVersion,
          createdAt: new Date().toISOString(),
          durationSeconds: composed.durationSeconds,
        });
      });
      return { key: composed.key, durationSeconds: composed.durationSeconds };
    } catch (error) {
      const message =
        error instanceof AudioError || error instanceof HttpError || error instanceof NonRetryableError
          ? error.message
          : '音频制作失败，请重试；已完成的分段保留在素材库';
      await step.do('record-audio-failure', () => setAudioState(this.env, snapshot, 'failed', message));
      throw new NonRetryableError(message);
    }
  }
}
