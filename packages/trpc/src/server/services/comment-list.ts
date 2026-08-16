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

export type CommentMentionRow = {
  commentId: number;
  userId: string;
  username: string;
};

export type CommentListItem = CommentListRow & {
  mentions: Omit<CommentMentionRow, "commentId">[];
};

export type CommentThread = CommentListItem & {
  replies: CommentListItem[];
};

export function buildCommentThreads(
  rows: CommentListRow[],
  mentionRows: CommentMentionRow[] = [],
): CommentThread[] {
  const rowsById = new Map<number, CommentListRow>();
  const mentionsByCommentId = new Map<
    number,
    Omit<CommentMentionRow, "commentId">[]
  >();

  for (const row of rows) {
    rowsById.set(row.id, row);
  }

  for (const { commentId, userId, username } of mentionRows) {
    const mentions = mentionsByCommentId.get(commentId) ?? [];
    if (!mentions.some((mention) => mention.userId === userId)) {
      mentions.push({ userId, username });
      mentionsByCommentId.set(commentId, mentions);
    }
  }

  const orderedRows: CommentListItem[] = [...rowsById.values()]
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id - right.id,
    )
    .map((row) => ({
      ...row,
      mentions: mentionsByCommentId.get(row.id) ?? [],
    }));
  const repliesByParentId = new Map<number, CommentListItem[]>();

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
