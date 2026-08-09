export type CommentListRow = {
  id: number;
  content: string;
  parentCommentId: number | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
};

export type CommentThread = CommentListRow & {
  replies: CommentListRow[];
};

export function buildCommentThreads(rows: CommentListRow[]): CommentThread[] {
  const rowsById = new Map<number, CommentListRow>();

  for (const row of rows) {
    rowsById.set(row.id, row);
  }

  const orderedRows = [...rowsById.values()].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id - right.id,
  );
  const repliesByParentId = new Map<number, CommentListRow[]>();

  for (const row of orderedRows) {
    if (row.parentCommentId === null) continue;

    const replies = repliesByParentId.get(row.parentCommentId) ?? [];
    replies.push(row);
    repliesByParentId.set(row.parentCommentId, replies);
  }

  return orderedRows
    .filter((row) => row.parentCommentId === null)
    .map((comment) => ({
      ...comment,
      replies: repliesByParentId.get(comment.id) ?? [],
    }));
}
