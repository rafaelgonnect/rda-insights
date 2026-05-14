import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    extraHTTPHeaders: {
      authorization:
        "Basic " +
        Buffer.from(`${process.env.APP_USERNAME ?? "test"}:${process.env.APP_PASSWORD ?? "testpassword"}`).toString("base64"),
    },
  },
});
