import { describe, expect, it } from "vitest";

import {
  extractMentionUsernames,
  findActiveMention,
  parseMentionTokens,
  replaceActiveMention,
} from "./commentMentions";

describe("comment mentions", () => {
  it("parses unique, valid username tokens with their ranges", () => {
    const content = "Thanks @alice_1 and @bob. @alice_1!";

    expect(parseMentionTokens(content)).toEqual([
      { username: "alice_1", start: 7, end: 15 },
      { username: "bob", start: 20, end: 24 },
      { username: "alice_1", start: 26, end: 34 },
    ]);
    expect(extractMentionUsernames(content)).toEqual(["alice_1", "bob"]);
  });

  it("ignores email-like, uppercase, short, and overlong tokens", () => {
    const content =
      "cook@example.com @ab @Alice @aliceB @abcdefghijklmnopqrstu @valid_user";

    expect(extractMentionUsernames(content)).toEqual(["valid_user"]);
  });

  it("finds the mention being edited at the cursor", () => {
    expect(
      findActiveMention("Ask @Ali_ce tomorrow", { start: 8, end: 8 }),
    ).toEqual({ query: "ali", start: 4, end: 11 });
  });

  it("activates a bare mention trigger but not an @ inside a word", () => {
    expect(findActiveMention("Ask @", { start: 5, end: 5 })).toEqual({
      query: "",
      start: 4,
      end: 5,
    });
    expect(findActiveMention("email@ali", { start: 9, end: 9 })).toBeNull();
  });

  it("replaces the whole active token and places the cursor after a space", () => {
    expect(
      replaceActiveMention(
        "Ask @alcie tomorrow",
        { start: 4, end: 10 },
        "alice",
      ),
    ).toEqual({ content: "Ask @alice tomorrow", cursor: 10 });
  });
});
