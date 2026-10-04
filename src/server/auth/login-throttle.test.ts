import { describe, expect, it } from "vitest";
import { afterFailure, clientIp, isLocked, LIMITS, LOCK_MS, throttleKeys, WINDOW_MS } from "./login-throttle";

const t0 = new Date("2026-10-04T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("login throttle policy", () => {
  it("locks an email after the limit is reached inside the window", () => {
    let state = null;
    for (let i = 1; i < LIMITS.email; i++) {
      state = afterFailure(state, at(i * 1000), LIMITS.email);
      expect(isLocked(state, at(i * 1000))).toBe(false);
    }
    state = afterFailure(state, at(LIMITS.email * 1000), LIMITS.email);
    expect(isLocked(state, at(LIMITS.email * 1000 + 1))).toBe(true);
    expect(state.lockedUntil!.getTime()).toBe(at(LIMITS.email * 1000).getTime() + LOCK_MS);
  });

  it("unlocks once the lock expires", () => {
    const locked = { failures: LIMITS.email, windowStart: t0, lockedUntil: at(LOCK_MS) };
    expect(isLocked(locked, at(LOCK_MS - 1))).toBe(true);
    expect(isLocked(locked, at(LOCK_MS + 1))).toBe(false);
  });

  it("starts a fresh window after the old one has lapsed", () => {
    const old = { failures: LIMITS.email - 1, windowStart: t0, lockedUntil: null };
    const next = afterFailure(old, at(WINDOW_MS + 1), LIMITS.email);
    expect(next.failures).toBe(1);
    expect(isLocked(next, at(WINDOW_MS + 2))).toBe(false);
  });

  it("keys on the normalised email and the client address", () => {
    expect(throttleKeys("  Admin@Example.COM ", "203.0.113.9").map((k) => k.key)).toEqual(["email:admin@example.com", "ip:203.0.113.9"]);
    expect(throttleKeys("a@b.c", null)).toHaveLength(1);
  });

  it("reads the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});
