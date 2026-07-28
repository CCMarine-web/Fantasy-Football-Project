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
 * actually decoded the file — along with the opacity that survives every scrim
 * stacked on top of it.
 *
 * What it checks, per route, at 1440x900 and at iPhone 13 width:
 *   - HTTP status of the document
 *   - a background image exists, loaded, and lands in the 8-25% visible band
 *   - no horizontal overflow of the document
 *   - no image missing meaningful alt text
 *   - no link pointing at "#" or an empty href
 *   - no sizeable element rendered completely empty
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

/**
 * The in-page probe, as SOURCE rather than as a function.
 *
 * tsx compiles with esbuild's keepNames enabled, which wraps named function
 * expressions in a `__name()` helper. That helper exists in the Node module and
 * not in the page, so handing `page.evaluate` a real function produced
 * "ReferenceError: __name is not defined" on every route. A plain string has no
 * such baggage, and it is also the honest signal that this code runs somewhere
 * else entirely.
 */
const PROBE_SOURCE = `(() => {
  function alphaOf(color) {
    // rgb(r g b / a) | oklch(l c h / a) | color(srgb r g b / a)
    var slash = /\\/\\s*([0-9.]+%?)\\s*\\)/.exec(color);
    if (slash) {
      var raw = slash[1];
      return raw.charAt(raw.length - 1) === "%" ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    }
    var legacy = /rgba\\(([^)]+)\\)/.exec(color);
    if (legacy) {
      var parts = legacy[1].split(",");
      return parts.length >= 4 ? Number(parts[3]) : 1;
    }
    var t = color.trim();
    if (t === "transparent") return 0;
    return /^(rgb|oklch|oklab|hsl|color)\\(/.test(t) ? 1 : 0;
  }

  // The fixed, aria-hidden layer the site paints its photograph into.
  var layer = document.querySelector('[aria-hidden="true"].fixed.inset-0');
  var bgImg = layer ? layer.querySelector("img") : null;

  var background = null;
  if (bgImg) {
    var imageOpacity = Number(window.getComputedStyle(bgImg).opacity);
    /*
     * Every scrim stacked on top of the photo cuts what survives. The alpha has
     * to be read out of whatever notation the browser reports, which is NOT
     * always rgba(): Tailwind's bg-background/55 computes to
     * "oklch(0.2 0 0 / 0.55)". An rgba-only regex found no alpha, scored every
     * scrim as fully transparent, and reported the raw 30% image opacity as the
     * visible result on all sixteen routes.
     */
    var survives = imageOpacity;
    var children = Array.prototype.slice.call(layer.children);
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (el === bgImg) continue;
      var s = window.getComputedStyle(el);
      // A gradient wash covers only part of the layer, so it cannot be charged
      // against the whole page's visibility.
      if (s.backgroundImage && s.backgroundImage !== "none") continue;
      var a = alphaOf(s.backgroundColor);
      if (isFinite(a)) survives *= 1 - a;
    }
    background = {
      src: bgImg.currentSrc || bgImg.src,
      // naturalWidth is only non-zero once the file has actually decoded.
      loaded: bgImg.complete && bgImg.naturalWidth > 0,
      effectiveOpacity: Number(survives.toFixed(3)),
    };
  }

  var overflowPx = Math.max(
    0,
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );

  var imagesWithoutAlt = [];
  var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
  for (var j = 0; j < imgs.length; j++) {
    var img = imgs[j];
    if (img.closest('[aria-hidden="true"]')) continue;
    var alt = img.getAttribute("alt");
    if (alt === "") continue; // deliberately decorative
    // Generic alt text is barely better than none.
    if (!alt || /^(image|photo|picture|logo|icon|avatar|thumbnail)$/i.test(alt.trim())) {
      imagesWithoutAlt.push((img.currentSrc || img.src).slice(-70));
    }
  }

  var deadLinks = [];
  var anchors = Array.prototype.slice.call(document.querySelectorAll("a"));
  for (var k = 0; k < anchors.length; k++) {
    var href = anchors[k].getAttribute("href");
    if (href === "#" || href === "" || href == null) {
      deadLinks.push((anchors[k].textContent || "").trim().slice(0, 50) || "(no text)");
    }
  }

  /*
   * A block with real height and nothing at all inside it — the "empty black
   * box" a reader takes for a broken component.
   */
  var emptyBlocks = 0;
  var blocks = Array.prototype.slice.call(document.querySelectorAll("main div, main section"));
  for (var m = 0; m < blocks.length; m++) {
    var rect = blocks[m].getBoundingClientRect();
    if (rect.height < 60 || rect.width < 120) continue;
    if ((blocks[m].textContent || "").trim().length > 0) continue;
    if (blocks[m].querySelector("img, svg, canvas, input, button, video")) continue;
    emptyBlocks++;
  }

  return { background: background, overflowPx: overflowPx, imagesWithoutAlt: imagesWithoutAlt, deadLinks: deadLinks, emptyBlocks: emptyBlocks };
})()`;

interface Finding {
  route: string;
  viewport: string;
  kind: string;
  detail: string;
}

const findings: Finding[] = [];
const note = (route: string, viewport: string, kind: string, detail: string) =>
  findings.push({ route, viewport, kind, detail });

interface ProbeResult {
  background: { src: string; loaded: boolean; effectiveOpacity: number } | null;
  overflowPx: number;
  imagesWithoutAlt: string[];
  deadLinks: string[];
  emptyBlocks: number;
}

interface PageReport extends ProbeResult {
  status: number;
  consoleErrors: string[];
}

async function inspect(page: Page, base: string, route: string): Promise<PageReport> {
  const consoleErrors: string[] = [];
  const listener = (msg: { type(): string; text(): string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  };
  page.on("console", listener);

  try {
    const response = await page.goto(`${base}${route}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    // Backgrounds below the fold load lazily; give the decode a moment.
    await page.waitForTimeout(1200);
    const result = (await page.evaluate(PROBE_SOURCE)) as ProbeResult;
    return { status: response?.status() ?? 0, consoleErrors, ...result };
  } finally {
    page.off("console", listener);
  }
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
      note(
        route,
        label,
        "background",
        `element present but the file never decoded: ${report.background.src}`,
      );
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
      note(
        route,
        label,
        "empty block",
        `${report.emptyBlocks} sizeable element(s) with nothing in them`,
      );
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
