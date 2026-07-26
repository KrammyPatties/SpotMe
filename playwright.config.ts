import { defineConfig, devices } from "@playwright/test";

/**
 * System (end-to-end) tests - the third tier of the testing strategy, above
 * Vitest unit tests (pure logic) and Vitest integration tests (endpoints
 * against a dedicated Supabase test project).
 *
 * Scope is deliberately UNAUTHENTICATED. Clerk-authenticated journeys need
 * @clerk/testing and a test user, which is real setup; this suite instead
 * covers what can be asserted from outside the auth boundary: the landing page
 * renders, protected pages turn a signed-out visitor away, and privileged API
 * routes reject unauthenticated writes. Authenticated journeys are documented
 * as a known gap rather than half-built.
 *
 * Runs against the DEPLOYED app by default, so CI needs no secrets and no
 * build.
 *
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 */
export default defineConfig({
  // Scoped to e2e/ so Playwright never picks up the Vitest suites in lib/.
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Two retries in CI: these cross a real network to a real deployment.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://spotme-phi.vercel.app",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});