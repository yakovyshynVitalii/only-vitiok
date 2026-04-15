import { describe, expect, test } from "vitest";

async function loadModule() {
  const mod = await import("../../scripts/upload-targets.js");
  return (mod.default || mod) as {
    parseUploadTargets: (env: Record<string, string>) => {
      distributionMode: "range" | "even";
      targets: Array<{
        collectionId: string;
        createUrl: string;
        rangeStart: number | null;
        rangeEnd: number | null;
      }>;
    };
    planUploads: (
      items: Array<{ id: string; uploaded?: boolean }>,
      targets: Array<{
        collectionId: string;
        createUrl: string;
        rangeStart: number | null;
        rangeEnd: number | null;
      }>,
      distributionMode?: "range" | "even"
    ) => {
      plans: Array<{
        collectionId: string;
        createUrl: string;
        rangeStart: number | null;
        rangeEnd: number | null;
        label: string;
        items: Array<{ id: string; uploaded?: boolean }>;
      }>;
      assignedCount: number;
      unassignedItems: Array<{ id: string; uploaded?: boolean }>;
    };
  };
}

describe("upload target helpers", () => {
  test("parseUploadTargets falls back to legacy CREATE_URL", async () => {
    const { parseUploadTargets } = await loadModule();

    expect(
      parseUploadTargets({
        CREATE_URL: "https://collections.only-nice.com/collection/legacy",
      })
    ).toEqual({
      distributionMode: "range",
      targets: [
        {
          collectionId: "legacy",
          createUrl: "https://collections.only-nice.com/collection/legacy",
          rangeStart: null,
          rangeEnd: null,
        },
      ],
    });
  });

  test("parseUploadTargets normalizes JSON targets and derives url from BASE_URL", async () => {
    const { parseUploadTargets } = await loadModule();

    expect(
      parseUploadTargets({
        BASE_URL: "https://collections.only-nice.com",
        UPLOAD_DISTRIBUTION_MODE: "even",
        UPLOAD_COLLECTIONS: JSON.stringify([
          {
            collectionId: "first",
            rangeStart: 1,
            rangeEnd: 50,
          },
          {
            createUrl: "https://collections.only-nice.com/collection/second",
            rangeStart: 51,
            rangeEnd: 100,
          },
        ]),
      })
    ).toEqual({
      distributionMode: "even",
      targets: [
        {
          collectionId: "first",
          createUrl: "https://collections.only-nice.com/collection/first",
          rangeStart: 1,
          rangeEnd: 50,
        },
        {
          collectionId: "second",
          createUrl: "https://collections.only-nice.com/collection/second",
          rangeStart: 51,
          rangeEnd: 100,
        },
      ],
    });
  });

  test("planUploads respects manual ranges and leaves gaps unassigned", async () => {
    const { planUploads } = await loadModule();
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

    const result = planUploads(
      items,
      [
        {
          collectionId: "first",
          createUrl: "https://collections.only-nice.com/collection/first",
          rangeStart: 1,
          rangeEnd: 2,
        },
        {
          collectionId: "second",
          createUrl: "https://collections.only-nice.com/collection/second",
          rangeStart: 4,
          rangeEnd: 5,
        },
      ],
      "range"
    );

    expect(result.assignedCount).toBe(4);
    expect(result.plans[0]?.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.plans[1]?.items.map((item) => item.id)).toEqual(["d", "e"]);
    expect(result.unassignedItems.map((item) => item.id)).toEqual(["c"]);
  });

  test("planUploads de-duplicates overlapping ranges", async () => {
    const { planUploads } = await loadModule();
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

    const result = planUploads(
      items,
      [
        {
          collectionId: "first",
          createUrl: "https://collections.only-nice.com/collection/first",
          rangeStart: 1,
          rangeEnd: 3,
        },
        {
          collectionId: "second",
          createUrl: "https://collections.only-nice.com/collection/second",
          rangeStart: 3,
          rangeEnd: 4,
        },
      ],
      "range"
    );

    expect(result.plans[0]?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.plans[1]?.items.map((item) => item.id)).toEqual(["d"]);
  });

  test("planUploads splits items evenly between collections", async () => {
    const { planUploads } = await loadModule();
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

    const result = planUploads(
      items,
      [
        {
          collectionId: "first",
          createUrl: "https://collections.only-nice.com/collection/first",
          rangeStart: null,
          rangeEnd: null,
        },
        {
          collectionId: "second",
          createUrl: "https://collections.only-nice.com/collection/second",
          rangeStart: null,
          rangeEnd: null,
        },
      ],
      "even"
    );

    expect(result.assignedCount).toBe(5);
    expect(result.plans[0]?.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.plans[1]?.items.map((item) => item.id)).toEqual(["d", "e"]);
    expect(result.unassignedItems).toEqual([]);
  });
});
