/**
 * preferences.ts
 *
 * Notification channel preferences per user per tenant.
 * Stored in `tenants.config` JSONB under the key `notif_prefs.{userId}`.
 * No separate table — this keeps migrations simple and preferences flexible.
 */

export type NotificationPreferences = {
  channels: {
    email: boolean;
    inApp: boolean;
    sms: boolean;
  };
  /** Per-template channel overrides — templateId → channel overrides */
  templateOverrides: Record<
    string,
    { email?: boolean; inApp?: boolean; sms?: boolean }
  >;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  channels: { email: true, inApp: true, sms: false },
  templateOverrides: {},
};

/**
 * Build the JSONB path key for a user's preferences within tenants.config.
 */
export function prefsKey(userId: string): string {
  // Stored as tenants.config.notif_prefs[userId]
  return `notif_prefs.${userId}`;
}

/**
 * Merge partial preference updates onto existing preferences.
 * Always returns a fully-typed object with all required fields.
 */
export function mergePreferences(
  existing: NotificationPreferences,
  updates: Partial<NotificationPreferences>,
): NotificationPreferences {
  return {
    channels: {
      ...existing.channels,
      ...(updates.channels ?? {}),
    },
    templateOverrides: {
      ...existing.templateOverrides,
      ...(updates.templateOverrides ?? {}),
    },
  };
}
