import type { DbOrTx } from "@platform/db";
import { logger } from "@platform/logger";
import type { TriggerEvent } from "../event-schemas.js";
import type { NotifyConfig } from "../types.js";

export type { NotifyConfig };

export function executeNotifyAction(
  _db: DbOrTx,
  tenantId: string,
  _event: TriggerEvent,
  config: NotifyConfig,
): void {
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
