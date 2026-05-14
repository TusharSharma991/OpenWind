import { sql } from 'drizzle-orm';
import { db } from './client.js';

export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    );
    return fn(tx);
  });
}
