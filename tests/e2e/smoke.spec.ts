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
  "/weekly",
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
  "/chat",
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
  for (const route of ["/hall-of-shame", "/championship-belt", "/chat", "/weekly"]) {
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

test("the weekly hub is the primary navigation item and links onward", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize(DESKTOP);
  await expect(page.locator('header a[href="/weekly"]').first()).toBeVisible();

  await page.goto("/weekly");
  await expect(page.getByRole("heading", { name: /weekly league hub/i })).toBeVisible();
  // The hub must reach every page it summarises.
  for (const href of ["/matchups", "/standings", "/transactions", "/news"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
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

test("the public chat explains that names are reserved", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.getByText(/Verified Manager/i).first()).toBeVisible();
  await expect(page.getByText(/reserved/i).first()).toBeVisible();
});
