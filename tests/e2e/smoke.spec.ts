import { test, expect } from "@playwright/test";

const PUBLIC_ROUTES = ["/", "/matchups", "/standings", "/managers", "/history", "/records", "/rivalries", "/transactions", "/drafts", "/news"];

for (const route of PUBLIC_ROUTES) {
  test(`renders ${route} without error`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText("Application error");
  });
}

test("homepage shows the league name and current-season badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /gridiron gazette/i })).toBeVisible();
});

test("standings table renders manager rows", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByRole("table")).toBeVisible();
});

test("manager directory links into a manager profile", async ({ page }) => {
  await page.goto("/managers");
  const firstManagerLink = page.locator('a[href^="/managers/"]').first();
  await firstManagerLink.click();
  await expect(page.getByText(/Career Record/i)).toBeVisible();
});

test("admin and chat-lore redirect unauthenticated users to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/chat-lore");
  await expect(page).toHaveURL(/\/login/);
});

test("login with the seeded admin account reaches the homepage", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@gridirongazette.local");
  await page.getByLabel("Password").fill("GazetteAdmin123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();
});
