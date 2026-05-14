import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@platform/config';
import * as schema from './schema/index.js';

const queryClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 30,
});

export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
