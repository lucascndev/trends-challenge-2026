import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page.getByRole("heading", { name: "Planned portfolio" }).waitFor();
  await page.getByRole("heading", { name: "Nothing to track yet" }).waitFor();
  await page.screenshot({
    path: "test-results/performance-empty.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Desktop page must not overflow",
  );
  await page.getByRole("button", { name: "Screener", exact: true }).click();
  await page.getByRole("heading", { name: "566 stocks" }).waitFor();
  await page.getByRole("textbox", { name: "Search stocks" }).fill("ASML");
  assert.equal(await page.locator(".stock-table tbody tr").count(), 1);
  await page.getByRole("button", { name: /Add ASML .* to watchlist/ }).click();
  await page.getByRole("button", { name: /Add ASML .* to the plan/ }).click();
  await page.locator(".company-cell").first().click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("Why this stock?")
    .fill("Browser test thesis: review results and guidance.");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Clear search" }).click();
  for (const query of ["Aalberts", "ABN AMRO", "Acomo", "Accor"]) {
    await page.getByRole("textbox", { name: "Search stocks" }).fill(query);
    await page
      .getByRole("button", { name: /Add .* to the plan/ })
      .first()
      .click();
  }
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await page.getByRole("button", { name: "Equal weight" }).click();
  assert.equal(await page.locator(".weight-input").count(), 5);
  for (const input of await page.locator(".weight-input").all())
    assert.equal(await input.inputValue(), "20");
  await page
    .getByRole("heading", { name: "The plan meets the rules." })
    .waitFor();
  await page.locator(".weight-input").first().fill("90");
  await page
    .getByText("Allocations exceed the available capital.", { exact: true })
    .waitFor();
  await page
    .getByText("No single stock may exceed 25% of capital.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Equal weight" }).click();
  await page.screenshot({
    path: "test-results/portfolio-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("heading", { name: "Planned portfolio" }).waitFor();
  await page.getByRole("heading", { name: "Planned positions" }).waitFor();
  await page.screenshot({
    path: "test-results/performance-plan.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  assert.equal(
    await page.locator(".weight-input").count(),
    5,
    "Draft persists after reload",
  );
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const backup = await backupDownload;
  await backup.saveAs("test-results/browser-backup.json");
  await page
    .getByLabel("Restore portfolio backup")
    .setInputFiles("test-results/browser-backup.json");
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Screener", exact: true }).click();
  await page.getByRole("textbox", { name: "Search stocks" }).fill("ASML");
  await page.locator(".company-cell").first().click();
  assert.equal(
    await page.getByLabel("Why this stock?").inputValue(),
    "Browser test thesis: review results and guidance.",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.screenshot({
    path: "test-results/screener-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Listing review/ }).click();
  assert.equal(await page.locator(".stock-table tbody tr").count(), 11);
  await page
    .getByRole("textbox", { name: "Search stocks" })
    .fill("no company matches this text");
  await page
    .getByRole("heading", { name: "No stocks match this screen" })
    .waitFor();
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/performance-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile page must not overflow",
  );
  await page.getByRole("button", { name: "Screener", exact: true }).click();
  await page.screenshot({
    path: "test-results/screener-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile screener must contain its wide table",
  );
  assert.deepEqual(errors, [], "No runtime errors");
  console.log(
    "PASS: desktop/mobile layout, search, watchlist, plan allocation and 25% limit, research notes, reload persistence, performance page, empty filters, listing flags, backup and restore dialog.",
  );
} finally {
  await browser.close();
}
