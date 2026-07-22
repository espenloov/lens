import { describe, expect, it } from "vitest";

import { parsePropertyChatId, propertyChatIdSchema } from "./session";

const CHAT_ID = "b2d28ed6-a606-4fdd-bd4d-388bc4f21331";

describe("property chat session", () => {
  it("accepts a stable UUID chat identifier", () => {
    expect(parsePropertyChatId(CHAT_ID)).toBe(CHAT_ID);
    expect(propertyChatIdSchema.safeParse(CHAT_ID).success).toBe(true);
  });

  it("rejects missing, malformed, and repeated query parameters", () => {
    expect(parsePropertyChatId(undefined)).toBeNull();
    expect(parsePropertyChatId("not-a-chat-id")).toBeNull();
    expect(parsePropertyChatId([CHAT_ID, CHAT_ID])).toBeNull();
  });
});
