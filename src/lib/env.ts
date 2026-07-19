import { z } from "zod";

/**
 * Server-only environment access. Never import this from a Client Component
 * — it is not prefixed with NEXT_PUBLIC_ and Next.js will fail to bundle it
 * into client code, which is the point: no API keys ever reach the browser.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url().default("http://localhost:3000"),
  SLEEPER_LEAGUE_ID: z.string().optional().default(""),
  SLEEPER_API_BASE_URL: z.string().url().default("https://api.sleeper.app/v1"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  DEFAULT_HUMOR_LEVEL: z.coerce.number().int().min(1).max(5).default(3),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      // Surface a clear, actionable message in server logs instead of a raw
      // ZodError. On Vercel this almost always means the variable isn't set
      // under Settings → Environment Variables for the deployed environment.
      throw new Error(
        `Missing or invalid environment variables: ${missing}. ` +
          `Set these in your hosting provider's environment settings ` +
          `(on Vercel: Settings → Environment Variables). See .env.example.`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function isSleeperConfigured(): boolean {
  return getEnv().SLEEPER_LEAGUE_ID.trim().length > 0;
}

export function isAIConfigured(): boolean {
  return getEnv().OPENAI_API_KEY.trim().length > 0;
}
