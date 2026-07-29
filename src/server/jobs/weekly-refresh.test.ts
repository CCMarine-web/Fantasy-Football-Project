import { describe, expect, it } from "vitest";
import { safeError } from "./weekly-refresh";

describe("safeError", () => {
  it("redacts a known secret wherever it appears", () => {
    const secret = "sk-live-abcdefghijklmnop";
    const message = safeError(new Error(`OpenAI rejected key ${secret} twice`), [secret]);
    expect(message).not.toContain(secret);
    expect(message).toContain("[redacted]");
  });

  it("strips credentials embedded in a connection string", () => {
    // Prisma throws with the full DATABASE_URL in the message, and that string
    // was being written straight into an admin-visible audit-log row.
    const message = safeError(
      new Error("Can't reach database server at postgres://postgres:hunter2@db.example.com:6543/x"),
      [],
    );
    expect(message).not.toContain("hunter2");
    expect(message).toContain("[redacted]@");
  });

  it("collapses newlines and caps the length", () => {
    const message = safeError(new Error(`line one\n   line two\n\nline three${"x".repeat(1000)}`));
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it("handles a thrown non-Error", () => {
    expect(safeError("plain string failure", [])).toBe("plain string failure");
  });

  it("ignores short values so a one-character secret cannot redact everything", () => {
    // secretValues() filters to >= 8 characters for this reason; passing a
    // short one explicitly must still not blank the message.
    expect(safeError(new Error("a real failure"), ["a"])).toContain("real failure");
  });
});
