import { test, expect, type Page } from "@playwright/test";

/**
 * Public-site smoke and layout audit.
 *
 * Two things are checked for every public route, at a phone width and a desktop
 * width:
 *
 *  1. It renders. No error status, no React error boundary.
 *  2. It fits. Nothing pushes the document wider than the viewport — the single
 *     most common way a page "breaks" on a phone, and one that never shows up
 *     in a unit test. Elements that scroll INSIDE their own container (wide
 *     tables, the era breakdown) are fine; the page body is what must not
 *     scroll sideways.
 */

const PUBLIC_ROUTES = [
  "/",
  "/matchups",
  "/standings",
  "/managers",
  "/power-rankings",
  "/history",
  "/records",
  "/hall-of-shame",
  "/rivalries",
  "/championship-belt",
  "/transactions",
  "/drafts",
  "/draft-report-cards",
  "/trade-tribunal",
  "/news",
];

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** How far the document overflows its own viewport, in CSS pixels. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

for (const route of PUBLIC_ROUTES) {
  test(`renders ${route} without error`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test(`fits a phone viewport on ${route}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // A couple of pixels is sub-pixel rounding, not a broken layout.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });

  test(`fits a desktop viewport on ${route}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  });
}

test("every image on the visual pages actually loads", async ({ page }) => {
  // Backgrounds and profile photographs have broken before, and a broken
  // portrait is invisible in HTML — only the browser knows.
  for (const route of ["/", "/managers", "/championship-belt", "/hall-of-shame"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src),
    );
    expect(broken, `broken images on ${route}`).toEqual([]);
  }
});

test("no admin control is exposed to a signed-out visitor", async ({ page }) => {
  for (const route of ["/hall-of-shame", "/championship-belt", "/matchups"]) {
    await page.goto(route);
    const adminLinks = await page.locator('a[href^="/admin"]').count();
    expect(adminLinks, `admin links on ${route}`).toBe(0);
  }
});

test("admin routes redirect a signed-out visitor to the login page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/chat-lore");
  await expect(page).toHaveURL(/\/login/);
});

test("Matchups is the primary navigation item and links onward", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator('header a[href="/matchups"]').first()).toBeVisible();

  await page.goto("/matchups");
  await expect(page.getByRole("heading", { name: /^matchups$/i }).first()).toBeVisible();
  // The hub must reach every page it summarises.
  for (const href of ["/standings", "/transactions", "/news"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test("/weekly redirects to /matchups so old links still work", async ({ page }) => {
  await page.goto("/weekly");
  await expect(page).toHaveURL(/\/matchups$/);
  await expect(page.getByRole("heading", { name: /^matchups$/i }).first()).toBeVisible();
});

test("/weekly carries its week query string across the redirect", async ({ page }) => {
  await page.goto("/weekly?week=3");
  await expect(page).toHaveURL(/\/matchups\?week=3$/);
});

test("the public chat is gone, not merely unlinked", async ({ page }) => {
  // 404 for the page and the API, and no link to either anywhere in the shell.
  const pageResponse = await page.goto("/chat");
  expect(pageResponse?.status()).toBe(404);

  const api = await page.request.get("/api/chat");
  expect(api.status()).toBe(404);

  for (const route of ["/", "/matchups", "/managers"]) {
    await page.goto(route);
    expect(await page.locator('a[href="/chat"]').count(), `chat links on ${route}`).toBe(0);
    expect(await page.locator('a[href^="/chat?"]').count(), `chat links on ${route}`).toBe(0);
  }
});

test("the Hall of Shame states its last-place methodology and leads with the gallery", async ({
  page,
}) => {
  await page.goto("/hall-of-shame");
  await expect(page.getByRole("heading", { name: /punishment gallery/i })).toBeVisible();
  await expect(
    page.getByText(
      /Last place is determined by the regular-season standings, not consolation or Toilet Bowl results/i,
    ),
  ).toBeVisible();
});

test("manager directory links into a profile that shows a Luck Score", async ({ page }) => {
  await page.goto("/managers");
  await page.locator('a[href^="/managers/"]').first().click();
  await expect(page.getByText(/Career Luck Score/i).first()).toBeVisible();
  await expect(page.getByText(/Career Statistics/i).first()).toBeVisible();
});

test("the punishment gallery shows photographs and captions none of them", async ({ page }) => {
  await page.goto("/hall-of-shame");
  await page.waitForLoadState("networkidle");

  const gallery = page.locator("section", { has: page.getByRole("heading", { name: /punishment gallery/i }) });
  const images = gallery.locator("img");
  expect(await images.count()).toBeGreaterThan(0);

  /*
   * No year, no name, no description. The alt text is deliberately generic:
   * nothing on record says which punishment any of these photographs shows, so
   * captioning one would be inventing a fact about a real person.
   */
  for (const alt of await images.evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).alt))) {
    expect(alt).toBe("League punishment photograph");
  }
  await expect(gallery).not.toContainText(/\b20\d{2}\b/);

  // Opening one gives a larger view.
  await gallery.locator("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the last-place table sits below the whole gallery and is not split", async ({ page }) => {
  await page.goto("/hall-of-shame");
  const galleryHeading = page.getByRole("heading", { name: /punishment gallery/i });
  const tableHeading = page.getByRole("heading", { name: /last place by season/i });
  await expect(tableHeading).toBeVisible();

  const galleryBox = await galleryHeading.boundingBox();
  const tableBox = await tableHeading.boundingBox();
  expect(tableBox!.y).toBeGreaterThan(galleryBox!.y);

  // One uninterrupted table: exactly one <table> between the heading and the
  // next section heading, with a row per completed season.
  const table = page
    .locator("section", { has: tableHeading })
    .locator("table");
  await expect(table).toHaveCount(1);
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(0);
});

test("the standings do not rank teams that have not played", async ({ page }) => {
  await page.goto("/standings");
  const rows = page.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);

  const played = await page
    .locator("tbody tr")
    .evaluateAll((trs) =>
      trs.some((tr) => {
        const record = tr.querySelectorAll("td")[2]?.textContent ?? "";
        return !/^\s*0-0\s*$/.test(record);
      }),
    );

  if (played) {
    // In season: positions are real and must start at 1.
    await expect(rows.first().locator("td").first()).toHaveText("1");
    return;
  }

  /*
   * Preseason. Every position cell must be a dash — the table used to number ten
   * 0-0 teams 1 to 10 from whatever order the database returned, telling every
   * manager where they stood in a season nobody had played.
   */
  const positions = await rows
    .locator("td:first-child")
    .evaluateAll((tds) => tds.map((td) => (td.textContent ?? "").trim()));
  expect(positions.every((p) => p === "—")).toBe(true);
  await expect(page.getByText(/These are not rankings/i)).toBeVisible();
  await expect(
    page.getByText(/Listed by last season|Listed alphabetically/i).first(),
  ).toBeVisible();
});

test("every published weight breakdown adds up to 100%", async ({ page }) => {
  // The draft report cards published 30/24/18/15/12 — ninety-nine percent —
  // because each weight was rounded on its own. See distributePercentages.
  for (const route of ["/draft-report-cards", "/power-rankings"]) {
    await page.goto(route);
    const panel = page.locator("dl").first();
    const percents = await panel
      .locator("dt")
      .evaluateAll((dts) => dts.map((dt) => Number((dt.textContent ?? "").replace("%", ""))));
    expect(percents.length, `weights on ${route}`).toBeGreaterThan(0);
    expect(percents.reduce((a, b) => a + b, 0), `weights on ${route} must total 100`).toBe(100);
  }
});

test("the transaction wire pages, filters and searches", async ({ page }) => {
  await page.goto("/transactions");

  const cards = page.locator("article, [data-slot='card']");
  const firstPage = await cards.count();
  expect(firstPage).toBeGreaterThan(0);
  // 25 a page, plus the methodology/filter panel which is also a card.
  expect(firstPage).toBeLessThanOrEqual(30);

  const loadMore = page.getByRole("link", { name: /Load \d+ more/ });
  if (await loadMore.count()) {
    await loadMore.first().click();
    await expect(page).toHaveURL(/shown=/);
    expect(await cards.count()).toBeGreaterThan(firstPage);
  }

  // Player search puts the query in the URL so the result is shareable.
  await page.goto("/transactions");
  await page.getByPlaceholder(/Search by player name/i).fill("jefferson");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page).toHaveURL(/player=jefferson/);
  await expect(page.getByText(/matching/i).first()).toBeVisible();
});

test("official rivalry statistics never appear below the Other Pairings divider", async ({
  page,
}) => {
  await page.goto("/rivalries");
  const officialHeading = page.getByRole("heading", { name: /official rivalries/i });
  const othersHeading = page.getByRole("heading", { name: /other heated pairings/i });
  if ((await officialHeading.count()) === 0 || (await othersHeading.count()) === 0) return;

  const dividerY = (await othersHeading.boundingBox())!.y;

  /*
   * Each rivalry renders as ONE self-contained card. The defect was a card's
   * metric grid spilling past the divider, so official-rivalry numbers appeared
   * under a heading that says these are not official. Every card must sit
   * entirely on one side of the divider.
   */
  const officialSection = page.locator("section").filter({ has: officialHeading });
  const officialCards = officialSection.locator("[data-slot='card']");
  const count = await officialCards.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = (await officialCards.nth(i).boundingBox())!;
    expect(box.y + box.height, `official rivalry card ${i} crosses the divider`).toBeLessThan(
      dividerY,
    );
  }
});

test("season retrospectives are previews on the index and complete on the season page", async ({
  page,
}) => {
  await page.goto("/history");
  const firstCard = page.locator("[data-slot='card']").first();
  const indexWords = ((await firstCard.innerText()) ?? "").trim().split(/\s+/).length;
  // 150-250 words plus the heading and link furniture; nowhere near the ~600 of
  // a full retrospective, which is what the index used to print for every season.
  expect(indexWords).toBeLessThan(340);

  const link = page.getByRole("link", { name: /Read the full \d{4} retrospective/ }).first();
  if (await link.count()) {
    await link.click();
    await expect(page).toHaveURL(/\/history\/\d{4}/);
    const body = await page.locator("main, body").innerText();
    expect(body.trim().split(/\s+/).length).toBeGreaterThan(indexWords);
  }
});
