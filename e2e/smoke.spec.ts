import { test, expect } from "@playwright/test";

test("home → open dashboard → resumir gráfico → vê streaming", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible();
  const firstCard = page.locator("a").first();
  await firstCard.click();
  await expect(page.getByText("Insights de IA")).toBeVisible();
  await page.getByRole("button", { name: /Resumir gráfico/ }).click();
  await expect(page.locator("text=/Padrão|principal/").first()).toBeVisible({ timeout: 15_000 });
});
