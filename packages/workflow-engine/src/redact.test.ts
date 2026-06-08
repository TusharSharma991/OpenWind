/**
 * redact.test.ts
 *
 * Unit tests for redactMetadata and buildSensitivityMap.
 * No DB — pure function tests.
 */

import { describe, it, expect } from "vitest";
import { redactMetadata, buildSensitivityMap } from "./redact.js";
import type { FieldSensitivity } from "@platform/entity-engine";

// ── buildSensitivityMap ────────────────────────────────────────────────────────

describe("buildSensitivityMap", () => {
  it("includes only pii and financial fields", () => {
    const fields = [
      { name: "ssn", sensitivity: "pii" as FieldSensitivity },
      { name: "salary", sensitivity: "financial" as FieldSensitivity },
      { name: "title", sensitivity: "internal" as FieldSensitivity },
      { name: "description", sensitivity: "public" as FieldSensitivity },
    ];
    const map = buildSensitivityMap(fields);
    expect(map.size).toBe(2);
    expect(map.get("ssn")).toBe("pii");
    expect(map.get("salary")).toBe("financial");
    expect(map.has("title")).toBe(false);
    expect(map.has("description")).toBe(false);
  });

  it("returns empty map when no sensitive fields", () => {
    const fields = [
      { name: "title", sensitivity: "internal" as FieldSensitivity },
      { name: "description", sensitivity: "public" as FieldSensitivity },
    ];
    expect(buildSensitivityMap(fields).size).toBe(0);
  });

  it("returns empty map for empty field list", () => {
    expect(buildSensitivityMap([]).size).toBe(0);
  });
});

// ── redactMetadata ─────────────────────────────────────────────────────────────

describe("redactMetadata", () => {
  it("replaces pii field value with [REDACTED]", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    const result = redactMetadata({ ssn: "123-45-6789" }, map);
    expect(result["ssn"]).toBe("[REDACTED]");
  });

  it("replaces financial field value with [REDACTED]", () => {
    const map = new Map<string, FieldSensitivity>([["salary", "financial"]]);
    const result = redactMetadata({ salary: 95000 }, map);
    expect(result["salary"]).toBe("[REDACTED]");
  });

  it("passes through public field values verbatim", () => {
    const map = new Map<string, FieldSensitivity>();
    const result = redactMetadata({ status: "open" }, map);
    expect(result["status"]).toBe("open");
  });

  it("passes through internal field values verbatim", () => {
    const map = new Map<string, FieldSensitivity>();
    const result = redactMetadata({ internalNote: "review needed" }, map);
    expect(result["internalNote"]).toBe("review needed");
  });

  it("passes through non-field metadata keys (comment, triggeredBy) verbatim", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    const result = redactMetadata(
      { ssn: "123-45-6789", comment: "escalated", triggeredBy: "user" },
      map,
    );
    expect(result["ssn"]).toBe("[REDACTED]");
    expect(result["comment"]).toBe("escalated");
    expect(result["triggeredBy"]).toBe("user");
  });

  it("preserves field keys when values are redacted", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    const result = redactMetadata({ ssn: "123-45-6789" }, map);
    expect(Object.keys(result)).toContain("ssn");
  });

  it("handles a mixed payload correctly — some redacted, some not", () => {
    const map = new Map<string, FieldSensitivity>([
      ["ssn", "pii"],
      ["salary", "financial"],
    ]);
    const result = redactMetadata(
      {
        ssn: "000-00-0000",
        salary: 50000,
        title: "Engineer",
        status: "active",
      },
      map,
    );
    expect(result["ssn"]).toBe("[REDACTED]");
    expect(result["salary"]).toBe("[REDACTED]");
    expect(result["title"]).toBe("Engineer");
    expect(result["status"]).toBe("active");
  });

  it("returns empty object for empty metadata", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    expect(redactMetadata({}, map)).toEqual({});
  });

  it("is a no-op when sensitivity map is empty", () => {
    const input = { title: "Engineer", status: "active" };
    expect(redactMetadata(input, new Map())).toEqual(input);
  });

  it("does not mutate the input object", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    const input = { ssn: "123-45-6789" };
    redactMetadata(input, map);
    expect(input["ssn"]).toBe("123-45-6789"); // unchanged
  });

  it("does not traverse nested objects — replaces the whole value as a unit", () => {
    const map = new Map<string, FieldSensitivity>([["details", "pii"]]);
    const result = redactMetadata(
      { details: { ssn: "000-00-0000", dob: "1990-01-01" } },
      map,
    );
    // Entire nested object is replaced, not traversed
    expect(result["details"]).toBe("[REDACTED]");
  });

  it("handles null and undefined values without throwing", () => {
    const map = new Map<string, FieldSensitivity>([["ssn", "pii"]]);
    const result = redactMetadata({ ssn: null, other: undefined }, map);
    expect(result["ssn"]).toBe("[REDACTED]");
    expect(result["other"]).toBeUndefined();
  });
});
