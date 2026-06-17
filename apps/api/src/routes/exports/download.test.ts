import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { AuthContext } from "@platform/auth";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetJob = vi.fn();

vi.mock("@platform/auth", () => ({
  requireAuth: () => async (_c: Context, next: Next) => {
    await next();
  },
}));

vi.mock("../../lib/export-queue.js", () => ({
  exportQueue: { getJob: (...args: unknown[]) => mockGetJob(...args) },
}));

const { exportsRouter } = await import("./download.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(tenantId = "tenant-aaa") {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      tenantId,
      userId: "u-001",
      roles: ["agent"],
      email: "a@b.com",
    });
    await next();
  });
  app.route("/exports", exportsRouter);
  return app;
}

function makeJob(
  state: string,
  tenantId = "tenant-aaa",
  returnvalue?: Record<string, unknown>,
) {
  return {
    data: { tenantId },
    returnvalue,
    getState: vi.fn().mockResolvedValue(state),
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /exports/:jobId/download", () => {
  it("returns 202 with status pending when job is active", async () => {
    mockGetJob.mockResolvedValue(makeJob("active"));
    const res = await makeApp().request("/exports/job-001/download");
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");
  });

  it("returns 202 with status pending when job is waiting", async () => {
    mockGetJob.mockResolvedValue(makeJob("waiting"));
    const res = await makeApp().request("/exports/job-001/download");
    expect(res.status).toBe(202);
  });

  it("returns 200 with downloadUrl when job is completed", async () => {
    mockGetJob.mockResolvedValue(
      makeJob("completed", "tenant-aaa", {
        downloadUrl: "https://s3.example.com/exports/tenant-aaa/job-001.csv",
        format: "csv",
        rowCount: 1234,
      }),
    );
    const res = await makeApp().request("/exports/job-001/download");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      downloadUrl: string;
    };
    expect(body.status).toBe("complete");
    expect(body.downloadUrl).toContain("s3.example.com");
  });

  it("returns 500 when job has failed", async () => {
    mockGetJob.mockResolvedValue(makeJob("failed"));
    const res = await makeApp().request("/exports/job-001/download");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("EXPORT_FAILED");
  });

  it("returns 404 when job does not exist", async () => {
    mockGetJob.mockResolvedValue(null);
    const res = await makeApp().request("/exports/nonexistent/download");
    expect(res.status).toBe(404);
  });

  it("returns 404 when job belongs to a different tenant", async () => {
    mockGetJob.mockResolvedValue(makeJob("completed", "tenant-bbb"));
    const res = await makeApp("tenant-aaa").request(
      "/exports/job-other-tenant/download",
    );
    expect(res.status).toBe(404);
  });
});
