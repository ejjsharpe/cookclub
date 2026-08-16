import { describe, expect, it } from "vitest";

import { buildCommentThreads, type CommentListRow } from "./comment-list";

function comment(
  id: number,
  parentCommentId: number | null,
  createdAt: string,
): CommentListRow {
  return {
    id,
    parentCommentId,
    createdAt: new Date(createdAt),
    content: `Comment ${id}`,
    user: {
      id: `user-${id}`,
      name: `User ${id}`,
      image: null,
    },
  };
}

describe("buildCommentThreads", () => {
  it("merges a separately fetched focused thread into the base comments", () => {
    const baseRows = [
      comment(1, null, "2026-01-01T00:00:00Z"),
      comment(2, 1, "2026-01-01T00:01:00Z"),
    ];
    const focusedRows = [
      comment(501, null, "2026-01-02T00:00:00Z"),
      comment(502, 501, "2026-01-02T00:01:00Z"),
    ];

    expect(buildCommentThreads([...baseRows, ...focusedRows])).toEqual([
      {
        ...baseRows[0],
        mentions: [],
        replies: [{ ...baseRows[1], mentions: [] }],
      },
      {
        ...focusedRows[0],
        mentions: [],
        replies: [{ ...focusedRows[1], mentions: [] }],
      },
    ]);
  });

  it("deduplicates rows returned by both the base and focused queries", () => {
    const parent = comment(1, null, "2026-01-01T00:00:00Z");
    const reply = comment(2, 1, "2026-01-01T00:01:00Z");

    expect(buildCommentThreads([parent, reply, parent, reply])).toEqual([
      {
        ...parent,
        mentions: [],
        replies: [{ ...reply, mentions: [] }],
      },
    ]);
  });

  it("attaches resolved mentions to roots and replies", () => {
    const parent = comment(1, null, "2026-01-01T00:00:00Z");
    const reply = comment(2, 1, "2026-01-01T00:01:00Z");

    expect(
      buildCommentThreads(
        [parent, reply],
        [
          { commentId: 1, userId: "alice-id", username: "alice" },
          { commentId: 2, userId: "bob-id", username: "bob" },
        ],
      ),
    ).toEqual([
      {
        ...parent,
        mentions: [{ userId: "alice-id", username: "alice" }],
        replies: [
          {
            ...reply,
            mentions: [{ userId: "bob-id", username: "bob" }],
          },
        ],
      },
    ]);
  });
});
