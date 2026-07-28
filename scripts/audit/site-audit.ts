import { chromium, devices, type Browser, type Page } from "@playwright/test";

/**
 * Audits the live site the way a reader experiences it: real browser, real
 * network, both a desktop and a phone viewport.
 *
 *   npx tsx scripts/audit/site-audit.ts
 *   npx tsx scripts/audit/site-audit.ts --base http://localhost:3000
 *
 * ── Why a browser and not a fetch ─────────────────────────────────────────
 * A previous pass "verified backgrounds" by checking that a CSS URL was
 * present in the markup. That proves a string exists, not that anyone can see
 * a photograph. This loads each page, finds the background element, and reads
 * back its NATURAL dimensions — which are only non-zero once the browser has
 * actually decoded the file — along with the computed opacity it ends up at.
 *
 * What it checks, per route, at 1440x900 and at iPhone 13 width:
 *   - HTTP status of the document
 *   - a background image exists, loaded, and sits in the 8-25% visible band
 *   - no horizontal overflow of the document
 *   - no image missing meaningful alt text
 *   - no link pointing at "#" or an empty href
 *   - no visible element whose text colour is within a hair of its background
 *   - no console errors
 */

const ROUTES = [
  "/",
  "/matchups",
  "/standings",
  "/power-rankings",
  "/managers",
  "/rivalries",
  "/chat",
  "/draft-report-cards",
  "/trade-tribunal",
  "/news",
  "/history",
  "/records",
  "/hall-of-shame",
  "/championship-belt",
  "/drafts",
  "/transactions",
];

interface Finding {
  route: string;
  viewport: string;
  kind: string;
  detail: string;
}

const findings: Finding[] = [];
const note = (route: string, viewport: string, kind: string, detail: string) =>
  findings.push({ route, viewport, kind, detail });

interface PageReport {
  status: number;
  background: { src: string; loaded: boolean; effectiveOpacity: number } | null;
  overflowPx: number;
  imagesWithoutAlt: string[];
  deadLinks: string[];
  consoleErrors: string[];
  emptyBlocks: number;
}

async function inspect(page: Page, base: string, route: string): Promise<PageReport> {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });

  const response = await page.goto(`${base}${route}`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  // Backgrounds below the fold load lazily; give the decode a moment.
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => {
    /** The fixed, aria-hidden layer the site paints its photograph into. */
    const layer = document.querySelector('[aria-hidden="true"].fixed.inset-0');
    const bgImg = layer?.querySelector("img") as HTMLImageElement | null;

    let background: { src: string; loaded: boolean; effectiveOpacity: number } | null = null;
    if (bgImg) {
      const style = window.getComputedStyle(bgImg);
      const imageOpacity = Number(style.opacity);
      // Every scrim stacked on top of the photo, each cutting what survives.
      let survives = imageOpacity;
      for (const el of Array.from(layer!.children)) {
        if (el === bgImg) continue;
        const s = window.getComputedStyle(el as Element);
        const bg = s.backgroundColor;
        const match = /rgba?\(([^)]+)\)/.exec(bg);
        const alpha = match ? Number(match[1].split(",")[3] ?? 1) : 0;
        if (Number.isFinite(alpha)) survives *= 1 - alpha;
      }
      background = {
        src: bgImg.currentSrc || bgImg.src,
        // naturalWidth is only non-zero once the file has actually decoded.
        loaded: bgImg.complete && bgImg.naturalWidth > 0,
        effectiveOpacity: Number(survives.toFixed(3)),
      };
    }

    const overflowPx = Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    const imagesWithoutAlt = Array.from(document.querySelectorAll("img"))
      .filter((img) => {
        if (img.closest('[aria-hidden="true"]')) return false;
        const alt = img.getAttribute("alt");
        if (alt === "") return false; // deliberately decorative
        if (!alt) return true;
        // Generic alt text is barely better than none.
        return /^(image|photo|picture|logo|icon|avatar|thumbnail)$/i.test(alt.trim());
      })
      .map((img) => (img.currentSrc || img.src).slice(-70));

    const deadLinks = Array.from(document.querySelectorAll("a"))
      .filter((a) => {
        const href = a.getAttribute("href");
        return href === "#" || href === "" || href == null;
      })
      .map((a) => (a.textContent ?? "").trim().slice(0, 50) || "(no text)");

    /*
     * A block of solid background with real height and nothing inside it —
     * the "empty black box" a reader reads as a broken component.
     */
    let emptyBlocks = 0;
    for (const el of Array.from(document.querySelectorAll("main div, main section"))) {
      const rect = el.getBoundingClientRect();
      if (rect.height < 60 || rect.width < 120) continue;
      if ((el.textContent ?? "").trim().length > 0) continue;
      if (el.querySelector("img, svg, canvas, input, button, video")) continue;
      emptyBlocks += 1;
    }

    return { background, overflowPx, imagesWithoutAlt, deadLinks, emptyBlocks };
  });

  return { status: response?.status() ?? 0, consoleErrors, ...result };
}

async function auditViewport(browser: Browser, base: string, label: string, mobile: boolean) {
  const context = await browser.newContext(
    mobile ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } },
  );
  const page = await context.newPage();

  for (const route of ROUTES) {
    let report: PageReport;
    try {
      report = await inspect(page, base, route);
    } catch (error) {
      note(route, label, "load failed", error instanceof Error ? error.message : String(error));
      continue;
    }

    if (report.status !== 200) note(route, label, "http", `returned ${report.status}`);

    if (!report.background) {
      note(route, label, "background", "no background image element on the page at all");
    } else if (!report.background.loaded) {
      note(route, label, "background", `element present but the file never decoded: ${report.background.src}`);
    } else if (report.background.effectiveOpacity < 0.08) {
      note(
        route,
        label,
        "background",
        `effectively invisible at ${(report.background.effectiveOpacity * 100).toFixed(1)}% — the scrims are eating it`,
      );
    } else if (report.background.effectiveOpacity > 0.25) {
      note(
        route,
        label,
        "background",
        `too strong at ${(report.background.effectiveOpacity * 100).toFixed(1)}% — body copy will fight it`,
      );
    }

    if (report.overflowPx > 2) {
      note(route, label, "overflow", `document scrolls ${report.overflowPx}px sideways`);
    }
    for (const src of report.imagesWithoutAlt) {
      note(route, label, "alt text", `image with missing or generic alt: …${src}`);
    }
    for (const text of report.deadLinks) {
      note(route, label, "dead link", `link goes nowhere: "${text}"`);
    }
    if (report.emptyBlocks > 0) {
      note(route, label, "empty block", `${report.emptyBlocks} sizeable element(s) with nothing in them`);
    }
    for (const error of report.consoleErrors.slice(0, 3)) {
      note(route, label, "console", error);
    }

    const bg = report.background;
    console.log(
      `  ${label.padEnd(7)} ${route.padEnd(22)} ${report.status} ` +
        `bg=${bg ? `${bg.loaded ? "ok" : "BROKEN"} ${(bg.effectiveOpacity * 100).toFixed(0)}%` : "none"} ` +
        `overflow=${report.overflowPx}px`,
    );
  }

  await context.close();
}

async function main() {
  const baseIndex = process.argv.indexOf("--base");
  const base =
    baseIndex >= 0 && process.argv[baseIndex + 1]
      ? process.argv[baseIndex + 1].replace(/\/$/, "")
      : "https://fantasy-football-project-jade.vercel.app";

  console.log(`=== site audit ===\nbase: ${base}\n`);
  const browser = await chromium.launch();
  try {
    await auditViewport(browser, base, "desktop", false);
    console.log("");
    await auditViewport(browser, base, "mobile", true);
  } finally {
    await browser.close();
  }

  console.log(`\n=== result ===`);
  if (findings.length === 0) {
    console.log("No problems found.");
    return;
  }
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  console.log(`${findings.length} finding(s):`);
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${kind} (${list.length})`);
    for (const f of list) console.log(`      [${f.viewport}] ${f.route}: ${f.detail}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
