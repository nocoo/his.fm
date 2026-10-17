import { z } from 'zod';

const mentionUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }, '链接需使用 http 或 https');

export const mentionSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  url: mentionUrl.optional(),
});

export const mentionsSchema = z.array(mentionSchema).max(50);

export type Mention = z.infer<typeof mentionSchema>;
