"use client";

import { useEffect } from "react";

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
          background: "#16181d",
          color: "#e9eaec",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>The Gridiron Gazette is unavailable</h1>
        <p style={{ maxWidth: "32rem", color: "#a0a4ab", fontSize: "0.9rem" }}>
          The site couldn&apos;t start up. This usually means a required server setting (such as the
          database connection or auth secret) is missing or invalid.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#e6b325",
            color: "#1a1500",
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
