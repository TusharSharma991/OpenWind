import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Regression: this admin-only create form (a separate flow from
// /records/:slug/new) filtered out isSystem fields before rendering, so the
// auto-seeded "title" field never appeared as an input for entity types
// whose only field is the seeded title. Same root cause as record-create.tsx/
// record-detail.tsx/workflow-records.tsx.

const ENTITY_TYPE_ID = "et-1";

const mockFetchWithAuth = vi.fn((url: string): Promise<unknown> => {
  if (url === `/api/entity-types/${ENTITY_TYPE_ID}`) {
    return Promise.resolve({
      data: {
        id: ENTITY_TYPE_ID,
        name: "it_asset_request",
        plural: "IT Asset Requests",
      },
    });
  }
  if (url === `/api/entity-types/${ENTITY_TYPE_ID}/fields`) {
    return Promise.resolve({
      data: [
        {
          id: "f-title",
          name: "title",
          label: "Title / Unique ID",
          fieldType: "text",
          isSystem: true,
          isRequired: true,
          config: {},
        },
      ],
    });
  }
  if (url.includes("/workflows")) return Promise.resolve({ data: [] });
  if (url.includes("/users")) return Promise.resolve({ data: [] });
  return Promise.resolve({ data: [] });
});

vi.mock("../../lib/api.js", () => ({
  API_URL: "/api",
  fetchWithAuth: (url: string) => mockFetchWithAuth(url),
}));

vi.mock("../../entity-type-context.js", () => ({
  useEntityTypes: () => ({
    getTypeById: () => ({ id: ENTITY_TYPE_ID, moduleId: null }),
    modules: [],
  }),
  toTypeSlug: (s: string) => s.toLowerCase(),
}));

const { EntityInstanceCreate } = await import("./instance-create.js");

describe("EntityInstanceCreate — isSystem field visibility", () => {
  afterEach(() => {
    cleanup();
    mockFetchWithAuth.mockClear();
  });

  it("renders an isSystem field (title) as an input, not just non-system fields", async () => {
    render(
      <MemoryRouter
        initialEntries={[`/entity-types/${ENTITY_TYPE_ID}/records/new`]}
      >
        <Routes>
          <Route
            path="/entity-types/:id/records/new"
            element={<EntityInstanceCreate />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Title / Unique ID")).toBeDefined();
  });
});
