// Refresh market data for the whole universe, or for a subset:
//   node scripts/refresh-data.mjs --symbols=AMD,ASML.AS
import { readFile } from "node:fs/promises";
import { readMarket, refreshMarket, writeMarket } from "../server/market.mjs";
const { stocks } = JSON.parse(
  await readFile(
    new URL("../public/data/universe.json", import.meta.url),
    "utf8",
  ),
);
const arg = process.argv.find((a) => a.startsWith("--symbols="));
const wanted = arg
  ? arg
      .slice("--symbols=".length)
      .split(/[\s,]+/)
      .filter(Boolean)
  : null;
const selected = wanted ? stocks.filter((s) => wanted.includes(s.id)) : stocks;
if (wanted) {
  const unknown = wanted.filter((w) => !selected.some((s) => s.id === w));
  if (unknown.length) console.log(`Ignoring unknown symbols: ${unknown.join(", ")}`);
  if (!selected.length) {
    console.log("No eligible symbols to refresh.");
    process.exit(0);
  }
}
let lastStage = "";
const result = await refreshMarket(selected, await readMarket(), (p) => {
  if (p.stage !== lastStage || p.completed % 100 === 0) {
    console.log(`${p.stage}: ${p.completed}/${p.total}`);
    lastStage = p.stage;
  }
});
await writeMarket(result);
console.log(
  `${result.status}; ${selected.length} listings requested; ${Object.keys(result.quotes).length} cached quotes; ${result.errors.length} issues.`,
);
if (result.errors.length) console.log(result.errors.slice(0, 5));
if (["unavailable", "error"].includes(result.status)) process.exitCode = 1;
