import { test, expect } from "@playwright/test";

test("home → open dashboard → sees chat sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible();
  const firstCard = page.locator("a").first();
  await firstCard.click();
  await expect(page.getByText("Chat IA")).toBeVisible();
  await expect(page.getByPlaceholder(/Pergunte sobre o dashboard/)).toBeVisible();
});

// @live — tagged to skip in CI; runs against staging with a real LLM call
test.skip(
  !process.env.RUN_LIVE_TESTS,
  "chat @live: type a message and see tool activity pill"
);
test("chat @live: type a message and see tool activity pill", async ({ page }) => {
  const baseUrl =
    process.env.E2E_BASE_URL ??
    "https://rda-insights-rdasuperset.bdoje9.easypanel.host";
  await page.goto(`${baseUrl}/d/8`);
  await expect(page.getByText("Chat IA")).toBeVisible({ timeout: 15_000 });
  const input = page.getByPlaceholder(/Pergunte sobre o dashboard/);
  await input.fill("liste os gráficos deste dashboard");
  await input.press("Control+Enter");
  // Wait for tool activity to appear (tool pill contains the humanized name)
  await expect(
    page.locator("text=/lendo charts do dashboard|buscando gráficos/").first()
  ).toBeVisible({ timeout: 30_000 });
  // Eventually the assistant message should contain something meaningful
  await expect(
    page.locator("text=/gráfico|chart/i").first()
  ).toBeVisible({ timeout: 30_000 });
});
