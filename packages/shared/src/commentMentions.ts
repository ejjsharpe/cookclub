const USERNAME_CHARACTER = /^[a-z0-9_]$/i;
const STORED_USERNAME_CHARACTER = /^[a-z0-9_]$/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 20;

export type MentionToken = {
  username: string;
  start: number;
  end: number;
};

export type ActiveMention = {
  query: string;
  start: number;
  end: number;
};

function isUsernameCharacter(character: string | undefined): boolean {
  return character !== undefined && USERNAME_CHARACTER.test(character);
}

function isStoredUsernameCharacter(character: string | undefined): boolean {
  return character !== undefined && STORED_USERNAME_CHARACTER.test(character);
}

export function parseMentionTokens(content: string): MentionToken[] {
  const mentions: MentionToken[] = [];

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "@" || isUsernameCharacter(content[index - 1])) {
      continue;
    }

    let end = index + 1;
    while (isUsernameCharacter(content[end])) end += 1;

    const username = content.slice(index + 1, end);
    if (
      username.length >= MIN_USERNAME_LENGTH &&
      username.length <= MAX_USERNAME_LENGTH &&
      [...username].every(isStoredUsernameCharacter)
    ) {
      mentions.push({ username, start: index, end });
    }

    index = end - 1;
  }

  return mentions;
}

export function extractMentionUsernames(content: string): string[] {
  return [
    ...new Set(parseMentionTokens(content).map(({ username }) => username)),
  ];
}

export function findActiveMention(
  content: string,
  selection: { start: number; end: number },
): ActiveMention | null {
  if (selection.start !== selection.end) return null;

  const cursor = Math.min(Math.max(selection.start, 0), content.length);
  let mentionStart = cursor - 1;

  while (mentionStart >= 0 && isUsernameCharacter(content[mentionStart])) {
    mentionStart -= 1;
  }

  if (content[mentionStart] !== "@") return null;
  if (isUsernameCharacter(content[mentionStart - 1])) return null;

  const query = content.slice(mentionStart + 1, cursor);
  if (query.length > MAX_USERNAME_LENGTH) return null;

  let mentionEnd = cursor;
  while (isUsernameCharacter(content[mentionEnd])) mentionEnd += 1;

  return {
    query: query.toLowerCase(),
    start: mentionStart,
    end: mentionEnd,
  };
}

export function replaceActiveMention(
  content: string,
  mention: Pick<ActiveMention, "start" | "end">,
  username: string,
): { content: string; cursor: number } {
  const replacement = `@${username}`;
  const trailingSpace = mention.end === content.length ? " " : "";

  return {
    content: `${content.slice(0, mention.start)}${replacement}${trailingSpace}${content.slice(mention.end)}`,
    cursor: mention.start + replacement.length + trailingSpace.length,
  };
}
