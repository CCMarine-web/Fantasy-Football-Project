import { describe, expect, it } from "vitest";
import { authorizeCronRequest } from "./cron-auth";

const SECRET = "cron-secret-0123456789";

describe("authorizeCronRequest", () => {
  it("accepts the exact bearer token", () => {
    expect(authorizeCronRequest({ secret: SECRET, authorization: `Bearer ${SECRET}`, nodeEnv: "production" })).toEqual({ ok: true });
  });

  it("rejects a missing or wrong token when a secret is set", () => {
    for (const authorization of [null, "", `Bearer ${SECRET}x`, SECRET, `bearer ${SECRET}`]) {
      const result = authorizeCronRequest({ secret: SECRET, authorization, nodeEnv: "production" });
      expect(result).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("fails closed in production when the secret is missing", () => {
    for (const secret of ["", "   "]) {
      const result = authorizeCronRequest({ secret, authorization: null, nodeEnv: "production" });
      expect(result).toMatchObject({ ok: false, status: 503 });
      // Even a request that sends something is refused: there is nothing to match it against.
      expect(authorizeCronRequest({ secret, authorization: "Bearer ", nodeEnv: "production" }).ok).toBe(false);
    }
  });

  it("fails closed when NODE_ENV is unset or unexpected", () => {
    expect(authorizeCronRequest({ secret: "", authorization: null, nodeEnv: undefined }).ok).toBe(false);
    expect(authorizeCronRequest({ secret: "", authorization: null, nodeEnv: "test" }).ok).toBe(false);
  });

  it("allows an unauthenticated trigger only under next dev", () => {
    expect(authorizeCronRequest({ secret: "", authorization: null, nodeEnv: "development" })).toEqual({ ok: true });
  });

  it("still requires the token under next dev once a secret is set", () => {
    expect(authorizeCronRequest({ secret: SECRET, authorization: null, nodeEnv: "development" }).ok).toBe(false);
  });
});
