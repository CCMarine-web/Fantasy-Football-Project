import { describe, expect, it } from "vitest";
import { MAX_BODY_LENGTH, MAX_NAME_LENGTH, validateSubmission } from "./public-chat";

/**
 * These cover the parts of the public shoutbox that keep it safe without a
 * database: normalisation, length caps, impersonation blocking and the word
 * filter. Rate limiting is query-driven and covered by the route behaviour.
 *
 * Control and format characters are written as escape sequences rather than
 * pasted literally, so this file stays plain text and greps/diffs cleanly.
 */

const ZERO_WIDTH_SPACE = "\u200b";
const RTL_OVERRIDE = "\u202e";
const NUL = "\u0000";
const BELL = "\u0007";

describe("validateSubmission — normalisation", () => {
  it("trims and accepts an ordinary message", () => {
    const result = validateSubmission("  Quinn  ", "  first  ");
    expect(result.ok).toBe(true);
    expect(result.displayName).toBe("Quinn");
    expect(result.body).toBe("first");
  });

  it("rejects a body that is only whitespace", () => {
    expect(validateSubmission("Quinn", "     ").ok).toBe(false);
    expect(validateSubmission("Quinn", "\n\n\t").ok).toBe(false);
  });

  it("strips zero-width and bidirectional-override characters used to spoof names", () => {
    const spoofed = `Ad${ZERO_WIDTH_SPACE}min${RTL_OVERRIDE}`;
    const result = validateSubmission(spoofed, "hello");
    expect(result.displayName).not.toContain(ZERO_WIDTH_SPACE);
    expect(result.displayName).not.toContain(RTL_OVERRIDE);
    // Once the invisible padding is gone the name reads "Admin", so the
    // reserved-name rule catches what the padding was trying to sneak past.
    expect(result.displayName).toBe("Admin");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reserved/i);
  });

  it("removes control characters from the body", () => {
    const result = validateSubmission("Quinn", `a${NUL}b${BELL}c`);
    expect(result.body).toBe("abc");
  });

  it("collapses excessive blank lines rather than allowing a wall of newlines", () => {
    const result = validateSubmission("Quinn", "one\n\n\n\n\n\ntwo");
    expect(result.body).toBe("one\n\ntwo");
  });
});

describe("validateSubmission — length limits", () => {
  it("rejects a name below the minimum", () => {
    expect(validateSubmission("Q", "hi").ok).toBe(false);
  });

  it("rejects a name over the cap", () => {
    const result = validateSubmission("x".repeat(MAX_NAME_LENGTH + 1), "hi");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(new RegExp(`${MAX_NAME_LENGTH}`));
  });

  it("accepts a name exactly at the cap", () => {
    expect(validateSubmission("x".repeat(MAX_NAME_LENGTH), "hi").ok).toBe(true);
  });

  it("rejects a body over the cap", () => {
    const result = validateSubmission("Quinn", "y".repeat(MAX_BODY_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(new RegExp(`${MAX_BODY_LENGTH}`));
  });

  it("accepts a body exactly at the cap", () => {
    expect(validateSubmission("Quinn", "y".repeat(MAX_BODY_LENGTH)).ok).toBe(true);
  });

  it("rejects a multi-line name", () => {
    expect(validateSubmission("Quinn\nFuentes", "hi").ok).toBe(false);
  });
});

describe("validateSubmission — impersonation", () => {
  it.each([
    "admin",
    "Admin",
    "ADMINISTRATOR",
    "moderator",
    "mod",
    "System",
    "commissioner",
    "The Rat Trap",
    "rattrap",
    "Official",
    "support",
    "staff",
    "owner",
    "helper bot",
  ])("refuses the reserved name %j", (name) => {
    const result = validateSubmission(name, "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reserved/i);
  });

  it("allows ordinary names that merely contain a reserved word later on", () => {
    // The patterns are anchored, so a real name is not collateral damage.
    expect(validateSubmission("Modric", "hello").ok).toBe(true);
    expect(validateSubmission("Sysadmin Steve", "hello").ok).toBe(true);
  });
});

describe("validateSubmission — moderation", () => {
  it("blocks slurs", () => {
    const result = validateSubmission("Quinn", "you are a f4ggot");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/word filter/i);
  });

  it("blocks a slur used as a display name", () => {
    expect(validateSubmission("retard", "hello").ok).toBe(false);
  });

  it("blocks obvious link spam but allows a single link", () => {
    expect(validateSubmission("Quinn", "check http://a.com and http://b.com now").ok).toBe(false);
    expect(validateSubmission("Quinn", "see https://sleeper.app for the roster").ok).toBe(true);
  });

  it("allows ordinary league profanity, which is the point of the room", () => {
    expect(validateSubmission("Quinn", "that lineup was absolute dogshit").ok).toBe(true);
    expect(validateSubmission("Quinn", "damn, what a beat").ok).toBe(true);
  });
});

describe("validateSubmission — injection payloads are kept as literal text", () => {
  // The defence is that rendering never parses HTML, so these are stored and
  // displayed verbatim rather than being rejected or silently mangled.
  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "'; DROP TABLE PublicChatMessage; --",
    "{{constructor.constructor('alert(1)')()}}",
    "[click](javascript:alert(1))",
  ])("keeps %j intact as text", (payload) => {
    const result = validateSubmission("Quinn", payload);
    expect(result.ok).toBe(true);
    expect(result.body).toBe(payload);
  });
});

describe("validateSubmission — non-string input", () => {
  it("rejects missing or wrongly-typed fields without throwing", () => {
    expect(validateSubmission(undefined, undefined).ok).toBe(false);
    expect(validateSubmission(null, null).ok).toBe(false);
    expect(validateSubmission(42, {}).ok).toBe(false);
    expect(validateSubmission(["Quinn"], ["hi"]).ok).toBe(false);
  });
});
