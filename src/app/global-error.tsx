"use client";

import { useEffect } from "react";
import { BRAND } from "@/lib/branding";

/**
 * Last-resort boundary for errors thrown in the root layout itself (which the
 * route-level error.tsx cannot catch — e.g. an auth/config failure before any
 * page renders). Must render its own <html>/<body>. Kept dependency-free and
 * self-contained so it works even when the app shell fails to load.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "#090e12",
          color: "#e9eaec",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>{BRAND.name} is unavailable</h1>
        <p style={{ maxWidth: "32rem", color: "#a0a4ab", fontSize: "0.9rem" }}>
          Something broke on our end. Give it a minute and try again.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#41b0eb",
            color: "#04131d",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
