import { test, expect } from "@playwright/test";

/**
 * Pages behind Clerk middleware (proxy.ts). A signed-out visitor must not be
 * left on any of them.
 */
const PROTECTED_PAGES = ["/match", "/messages", "/progress", "/profile"];

/**
 * Write endpoints that must reject an unauthenticated caller. The integration
 * suite already asserts 401 with a mocked auth(); this asserts it end-to-end
 * against the deployed app, where the real Clerk middleware is in the path.
 */
const PROTECTED_ENDPOINTS = [
  { path: "/api/matches", data: { recipientId: "user_nobody" } },
  { path: "/api/messages", data: { chatroom_id: "x", content: "hi" } },
  { path: "/api/workouts", data: {} },
  { path: "/api/sessions", data: {} },
  { path: "/api/ratings", data: {} },
  { path: "/api/reports", data: { reported_id: "user_nobody", reason: "x" } },
  { path: "/api/admin/actions", data: {} },
];

test.describe("landing page", () => {
  test("renders for a signed-out visitor", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // The landing page exists to tell a new user what SpotMe is, so the brand
    // name should appear in its copy. Adjust the pattern if yours differs.
    await expect(page.locator("body")).toContainText(/find the right buddies/i);
  });

  test("offers a route into the app", async ({ page }) => {
    await page.goto("/");
    // Clerk renders its sign-in affordances as buttons, not links, so match
    // either role rather than assuming one.
    const entry = page
      .getByRole("link", { name: /sign in|sign up|get started/i })
      .or(page.getByRole("button", { name: /sign in|sign up|get started/i }));
    await expect(entry.first()).toBeVisible();
  });
});

test.describe("route protection", () => {
  for (const path of PROTECTED_PAGES) {
    test(`turns a signed-out visitor away from ${path}`, async ({ page }) => {
      await page.goto(path);

      // Compare PATHNAMES, not the whole URL: Clerk appends the original path
      // as a redirect_url query parameter, so a substring check on the full
      // URL would find "/match" in the query string and pass when it should
      // not. The pathname is the only honest thing to assert.
      const pathname = new URL(page.url()).pathname;
      expect(pathname).not.toBe(path);
    });
  }

  test("does not expose the moderation dashboard to a signed-out visitor", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page.locator("body")).not.toContainText(/Open reports/i);
  });
});

test.describe("API authorisation", () => {
  for (const { path, data } of PROTECTED_ENDPOINTS) {
    test(`${path} rejects an unauthenticated write`, async ({ request }) => {
      const response = await request.post(path, { data });
      // 401 from the route's own auth guard, or 3xx/404 if middleware
      // intercepts first. What must never happen is a 2xx.
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });
  }
});