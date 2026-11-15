import "./lib/load-env";

/**
 * Fires the weekly refresh against a locally running server, the same way
 * Vercel Cron does:
 *
 *   npm run dev            # in one terminal (no CRON_SECRET needed under next dev)
 *   npm run cron:trigger   # in another
 *
 *   npm run cron:trigger -- --url http://localhost:3123
 *   npm run cron:trigger -- --job daily      # daily | weekly | thursday | revalidate
 *
 * Against `next start` (a production build) the endpoint fails closed, so set
 * CRON_SECRET in .env; this script sends it as the bearer token.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const base = arg("url") ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const job = arg("job") ?? "weekly";
  const response = await fetch(`${base}/api/cron/${job}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok && response.status !== 207) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
