import { describe, expect, it } from "vitest";
import { plainTextParser } from "./plain-text";

describe("plainTextParser", () => {
  it("parses a few normal dash-delimited lines", async () => {
    const input = [
      "2023-09-10 14:32 - Alex: Bold trade, we'll see",
      "2023-09-10 14:35 - Jordan: No shot that works",
      "2023-09-10 14:36:12 - Alex: Watch me",
    ].join("\n");

    const result = await plainTextParser.parse(input);

    expect(result.warnings).toEqual([]);
    expect(result.messages).toHaveLength(3);
    expect(result.participantIdentifiers).toEqual(["Alex", "Jordan"]);

    expect(result.messages[0]).toMatchObject({
      senderRawIdentifier: "Alex",
      text: "Bold trade, we'll see",
      sourcePlatform: "PLAIN_TEXT",
    });
    expect(result.messages[0].timestamp).toBeInstanceOf(Date);
    expect(result.messages[0].timestamp.getFullYear()).toBe(2023);
    expect(result.messages[0].timestamp.getMonth()).toBe(8); // 0-indexed: September
    expect(result.messages[0].timestamp.getDate()).toBe(10);
    expect(result.messages[0].timestamp.getHours()).toBe(14);
    expect(result.messages[0].timestamp.getMinutes()).toBe(32);

    // Line with explicit seconds parses too.
    expect(result.messages[2].timestamp.getSeconds()).toBe(12);
  });

  it("appends continuation lines to the previous message (multi-line message)", async () => {
    const input = [
      "2023-09-10 14:32 - Alex: Bold trade, we'll see",
      "Actually let's talk more tomorrow",
      "I have thoughts",
    ].join("\n");

    const result = await plainTextParser.parse(input);

    expect(result.warnings).toEqual([]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe(
      "Bold trade, we'll see\nActually let's talk more tomorrow\nI have thoughts"
    );
  });

  it("parses the bracketed timestamp variant", async () => {
    const input = "[2023-09-11, 09:05:00] Jordan: Anyone hear from the commish?";

    const result = await plainTextParser.parse(input);

    expect(result.warnings).toEqual([]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      senderRawIdentifier: "Jordan",
      text: "Anyone hear from the commish?",
    });
    expect(result.messages[0].timestamp.getFullYear()).toBe(2023);
    expect(result.messages[0].timestamp.getMonth()).toBe(8);
    expect(result.messages[0].timestamp.getDate()).toBe(11);
    expect(result.messages[0].timestamp.getHours()).toBe(9);
    expect(result.messages[0].timestamp.getMinutes()).toBe(5);
    expect(result.messages[0].timestamp.getSeconds()).toBe(0);
  });

  it("records a warning (not a crash) for a garbage first line", async () => {
    const input = "asdkjasldkj not a valid line at all";

    const result = await plainTextParser.parse(input);

    expect(result.messages).toEqual([]);
    expect(result.participantIdentifiers).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unparseable line");
  });

  it("skips blank lines silently", async () => {
    const input = [
      "2023-09-10 14:32 - Alex: Bold trade, we'll see",
      "",
      "   ",
      "2023-09-10 14:35 - Jordan: No shot that works",
    ].join("\n");

    const result = await plainTextParser.parse(input);

    expect(result.warnings).toEqual([]);
    expect(result.messages).toHaveLength(2);
  });
});
