import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  REDIS_URL: z.string().url(),
  ZITADEL_ISSUER: z.string().url(),
  ZITADEL_AUDIENCE: z.string(),
  NOVU_API_KEY: z.string(),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  ANTHROPIC_API_KEY: z.string(),
  ENCRYPTION_KEY: z.string().length(64),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
