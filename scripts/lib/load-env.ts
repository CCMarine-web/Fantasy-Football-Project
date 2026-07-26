import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

/**
 * Env loading for standalone scripts, matching the order Next.js itself uses.
 *
 * `import "dotenv/config"` only reads `.env`, so anything kept out of the
 * committed file (ESPN cookies, OpenAI key) was invisible to scripts even
 * though `next dev` could see it. dotenv never overwrites a key that is
 * already defined, so listing `.env.local` first gives it precedence — the
 * same precedence Next.js applies.
 *
 * Import this instead of "dotenv/config" as the first import of any script.
 */
for (const file of [".env.local", ".env"]) {
  const path = join(process.cwd(), file);
  if (existsSync(path)) config({ path, quiet: true });
}
