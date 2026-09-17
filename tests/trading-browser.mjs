import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Isolated fixtures exercise the in-competition workflow. They never touch the real data files.
const history = [
  { date: "2026-10-06", close: 105 },
  { date: "2026-10-07", close: 110 },
  { date: "2026-10-08", close: 120 },
];
const index = {
  quotes: {
    "ASML.AS": {
      price: 120,
      priceDate: "2026-10-08",
      asOf: "2026-10-08T15:00:00Z",
      currency: "EUR",
      change: 9.09,
      spark: history.map((p) => p.close),
    },
  },
  fx: {
    rates: { EUR: 1, USD: 0.9 },
    history: { "2026-10-08": { USD: 0.9 } },
    date: "2026-10-08",
  },
  status: "updated",
  errors: [],
  lastAttempt: "2026-10-08T15:00:00Z",
  lastSuccess: "2026-10-08T15:00:00Z",
};
await page.route("**/data/market/index.json*", (route) =>
  route.fulfill({ json: index }),
);
await page.route("**/data/market/history/*", (route) =>
  route.fulfill({
    json: route.request().url().includes("ASML.AS")
      ? { symbol: "ASML.AS", history }
      : { symbol: "", history: [] },
  }),
);
await page.clock.setFixedTime(new Date("2026-10-08T17:00:00Z"));
try {
  await page.goto(process.env.TEST_URL || "http://localhost:3000");
  await page.getByRole("heading", { name: "Planned portfolio" }).waitFor();
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await page.getByRole("button", { name: /Trade journal/ }).click();
  await page.getByRole("button", { name: "Record execution" }).click();
  await page
    .getByLabel("Eligible stock", { exact: true })
    .selectOption("ASML.AS");
  await page.getByLabel("Execution date", { exact: true }).fill("2026-10-06");
  // 260 × 100 = 26,000 EUR: above the 25% position limit.
  await page.getByLabel("Number of shares", { exact: true }).fill("260");
  await page.getByLabel("Execution price · EUR", { exact: true }).fill("100");
  await page.getByLabel("Fee · EUR", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page.getByText(/above 25% of the portfolio/).waitFor();
  await page.getByLabel("Number of shares", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page.getByText("€1,002.00", { exact: true }).waitFor(); // cost
  await page.getByText("€1,200.00", { exact: true }).waitFor(); // value at 120
  await page.getByText(/1 holding; the challenge requires at least 5/).waitFor();
  await page.getByRole("button", { name: "Record trade", exact: true }).click();
  await page.getByLabel("Entry type", { exact: true }).selectOption("sell");
  await page.getByLabel("Number of shares", { exact: true }).fill("11");
  await page.getByLabel("Execution price · EUR", { exact: true }).fill("130");
  await page.getByLabel("Fee · EUR", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page
    .getByText("You cannot sell more shares than you hold.", { exact: true })
    .waitFor();
  await page.getByLabel("Number of shares", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page.getByText("€501.00", { exact: true }).waitFor(); // remaining cost
  await page.getByText("€600.00", { exact: true }).waitFor(); // 5 × 120
  // Performance page: cash 99,647 + 5 × 120 = 100,247
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await page.getByRole("heading", { name: "Portfolio performance" }).waitFor();
  await page.getByText("€100,247", { exact: true }).waitFor();
  await page.getByText("+0.25%", { exact: true }).waitFor();
  await page
    .getByRole("img", { name: "Portfolio value in EUR per session" })
    .waitFor();
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await page.getByRole("button", { name: /Trade journal/ }).click();
  await page
    .getByRole("button", { name: "Undo latest entry", exact: true })
    .click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Undo entry", exact: true }).click();
  await page.getByText("€1,002.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Record trade", exact: true }).click();
  await page.getByLabel("Entry type", { exact: true }).selectOption("split");
  await page.getByLabel(/New shares per old share/).fill("2");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page.getByText("20.00", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Record trade", exact: true }).click();
  await page.getByLabel("Entry type", { exact: true }).selectOption("dividend");
  await page.getByLabel("Net cash received · EUR", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save journal entry" }).click();
  await page.getByRole("cell", { name: "25.00", exact: true }).waitFor();
  await page.getByRole("button", { name: "Screener", exact: true }).click();
  await page.getByRole("textbox", { name: "Search stocks" }).fill("ASML");
  assert.equal(
    await page.getByRole("img", { name: /ASML.*last 30 daily closes/ }).count(),
    1,
  );
  await page.locator(".company-cell").first().click();
  await page
    .getByRole("img", { name: /ASML.*daily closing prices in EUR/ })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: execution form, 25% limit, EUR values, oversell rejection, partial sale P&L, performance page, undo, splits, distributions and chart rendering (isolated fixtures).",
  );
} finally {
  await browser.close();
}
