export type CursorPage<T> = {
  data: T[];
  nextCursor: string | null;
};

type CursorPayload = { createdAt: string; id: string };

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf-8");
    const payload = JSON.parse(raw) as CursorPayload;
    if (
      typeof payload.createdAt !== "string" ||
      typeof payload.id !== "string"
    ) {
      return null;
    }
    const createdAt = new Date(payload.createdAt);
    if (isNaN(createdAt.getTime())) return null;
    return { createdAt, id: payload.id };
  } catch {
    return null;
  }
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
