import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseCsv, toCsv } from "../shared/csv.mjs";

const root = new URL("../", import.meta.url);
const raw = await readFile(
  new URL("trends-invest-challenge-stock-lookup.csv", root),
  "utf8",
);
const input = parseCsv(raw);
const clean = (value) => value.normalize("NFC").replace(/\s+/g, " ").trim();
const seen = new Set();
const duplicates = [];
const stocks = input
  .flatMap((original, index) => {
    const r = Object.fromEntries(
      Object.entries(original).map(([k, v]) => [k, clean(v)]),
    );
    const id = r.yahoo_symbol;
    if (!id || !r.company_name || !r.quote_currency)
      throw new Error(`Missing identity at row ${index + 2}`);
    if (seen.has(id)) {
      duplicates.push({ row: index + 2, symbol: id });
      throw new Error(`Duplicate listing ${id}; manual review required`);
    }
    seen.add(id);
    const cap = r.market_cap === "" ? null : Number(r.market_cap);
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0))
      throw new Error(`Invalid market cap: ${id}`);
    const currency =
      r.quote_currency === "GBp" || r.quote_currency === "GBX"
        ? "GBP"
        : r.quote_currency;
    const flags = [];
    if (r.listing_match_status === "share class not confirmed")
      flags.push("share-class");
    if (cap === null) flags.push("missing-cap");
    if (
      r.market_cap_source_date &&
      (Date.parse(r.data_retrieved_date) -
        Date.parse(r.market_cap_source_date)) /
        86400000 >
        5
    )
      flags.push("older-cap");
    if (r.market_cap_precision === "rounded source display")
      flags.push("rounded-cap");
    const exchangeShort =
      {
        NYSE: "NYSE",
        "Nasdaq Global Select Market": "NASDAQ",
        "Nasdaq Capital Market": "NASDAQ",
        "Nasdaq Global Market": "NASDAQ",
        "Euronext Amsterdam": "AMSTERDAM",
        "Euronext Brussels": "BRUSSELS",
        "Euronext Paris": "PARIS",
        Xetra: "XETRA",
        "London Stock Exchange": "LONDON",
        "SIX Swiss Exchange": "SWISS",
        "Nasdaq Copenhagen": "COPENHAGEN",
        "Borsa Italiana (Euronext Milan)": "MILAN",
        "Australian Securities Exchange": "ASX",
        "Bolsa de Madrid": "MADRID",
        "Euronext Lisbon": "LISBON",
        "Oslo Bors (Euronext Oslo)": "OSLO",
        "Nasdaq Helsinki": "HELSINKI",
        "Korea Exchange (KOSPI)": "KOREA",
        "Nasdaq Stockholm": "STOCKHOLM",
      }[r.exchange] || r.exchange;
    return [
      {
        id,
        name: r.company_name,
        challengeName: r.challenge_name,
        ticker: r.ticker,
        exchange: r.exchange,
        exchangeShort,
        quoteCurrency: r.quote_currency,
        currency,
        quoteScale: currency === "GBP" && r.quote_currency !== "GBP" ? 0.01 : 1,
        sector: r.sector,
        industry: r.industry.replace(/\s*[—–]\s*/g, " — "),
        challengeSector: r.challenge_sector,
        marketCap: cap,
        marketCapCurrency: r.market_cap_currency || currency,
        marketCapDate: r.market_cap_source_date || null,
        marketCapDateBasis: r.market_cap_date_basis,
        marketCapPrecision: r.market_cap_precision,
        retrievedDate: r.data_retrieved_date,
        listingStatus: r.listing_match_status,
        notes: r.notes,
        alternatives: r.alternative_yahoo_symbols,
        flags,
        sourceRow: index + 2,
        sources: {
          quote: r.quote_url,
          listing: r.listing_source_url,
          classification: r.classification_source_url,
          marketCap: r.market_cap_source_url,
          supplemental: r.supplemental_source_url,
        },
      },
    ];
  })
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

const report = {
  sourceFile: "trends-invest-challenge-stock-lookup.csv",
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  rowsRead: input.length,
  rowsOutput: stocks.length,
  duplicates,
  exchanges: new Set(stocks.map((s) => s.exchange)).size,
  sectors: new Set(stocks.map((s) => s.sector)).size,
  currencies: new Set(stocks.map((s) => s.currency)).size,
  shareClassReview: stocks.filter((s) => s.flags.includes("share-class"))
    .length,
  missingMarketCaps: stocks.filter((s) => s.marketCap === null).length,
  penceQuotes: stocks.filter((s) => s.quoteScale === 0.01).length,
  olderMarketCaps: stocks.filter((s) => s.flags.includes("older-cap")).length,
  roundedMarketCaps: stocks.filter((s) => s.flags.includes("rounded-cap"))
    .length,
  snapshotDate: stocks
    .map((s) => s.retrievedDate)
    .sort()
    .at(-1),
  transformations: [
    "Trimmed whitespace and normalized Unicode (NFC).",
    "Preserved challenge names, symbols, listing caveats, source dates and URLs.",
    "Converted market caps to numbers; missing values remain null.",
    "Separated quote units from currency: GBp/GBX → GBP with 0.01 quote scale. Market caps retain GBP units.",
    "Kept source sector and challenge sector separately.",
    "Flagged unconfirmed share classes, caps older than five days at retrieval, rounded caps and missing caps.",
    "No invented prices, FX rates, earnings dates, or historical returns.",
  ],
};
await mkdir(new URL("public/data/", root), { recursive: true });
await mkdir(new URL("data/", root), { recursive: true });
await writeFile(
  new URL("public/data/universe.json", root),
  JSON.stringify({ report, stocks }),
);
await writeFile(
  new URL("data/quality-report.json", root),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  new URL("public/data/stocks-cleaned.csv", root),
  toCsv(
    stocks.map((s) => ({
      symbol: s.id,
      company_name: s.name,
      challenge_name: s.challengeName,
      ticker: s.ticker,
      exchange: s.exchange,
      quote_currency: s.quoteCurrency,
      currency: s.currency,
      quote_scale: s.quoteScale,
      sector: s.sector,
      industry: s.industry,
      challenge_sector: s.challengeSector,
      market_cap: s.marketCap,
      market_cap_currency: s.marketCapCurrency,
      market_cap_date: s.marketCapDate,
      market_cap_date_basis: s.marketCapDateBasis,
      market_cap_precision: s.marketCapPrecision,
      retrieved_date: s.retrievedDate,
      listing_status: s.listingStatus,
      flags: s.flags.join("; "),
      notes: s.notes,
      alternative_symbols: s.alternatives,
      source_row: s.sourceRow,
      quote_url: s.sources.quote,
      listing_source_url: s.sources.listing,
      classification_source_url: s.sources.classification,
      market_cap_source_url: s.sources.marketCap,
      supplemental_source_url: s.sources.supplemental,
    })),
  ),
);
console.log(JSON.stringify(report, null, 2));
