import type { DbOrTx } from "@platform/db";
import { logger } from "@platform/logger";
import type { TriggerEvent } from "../event-schemas.js";

export interface NotifyConfig {
  recipientId?: string;
  workflowId?: string;
  channel?: string[];
  payload?: Record<string, unknown>;
}

export async function executeNotifyAction(
  _db: DbOrTx,
  tenantId: string,
  _event: TriggerEvent,
  config: NotifyConfig,
): Promise<void> {
  // @platform/notifications is not wired to a provider yet — log and continue.
  logger.info(
    {
      tenantId,
      recipientId: config.recipientId,
      channel: config.channel,
    },
    "Automation: notify action (provider not wired)",
  );
}
