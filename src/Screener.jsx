import React, { useMemo, useState } from "react";
import {
  Button,
  Icon,
  Tag,
  Change,
  Sparkline,
  Empty,
  num,
  compact,
  dateLabel,
  download,
} from "./ui.jsx";
import {
  capToEur,
  isNum,
  positive,
  stale,
  START,
  END,
} from "../shared/finance.mjs";
import { toCsv } from "../shared/csv.mjs";

export default function Screener({
  stocks,
  market,
  watchlist,
  toggleWatch,
  draft,
  addDraft,
  openStock,
  filters,
  setFilters,
}) {
  const [page, setPage] = useState(1);
  const {
    query = "",
    sector = "",
    mode = "all",
    size = "",
    sort = "name",
    direction = "asc",
    momentum = "",
    trend = "",
    valuation = "",
    revenue = "",
    eps = "",
    dividend = "",
    range = "",
  } = filters;
  const update = (key, value) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  const reset = () => {
    setFilters({});
    setPage(1);
  };
  const sectors = [...new Set(stocks.map((s) => s.sector))].sort();
  // Every numeric screen requires a value: missing data never passes a filter.
  const between = (v, lo, hi) => isNum(v) && v >= lo && (hi == null || v < hi);
  const fresh = (q) => q && !stale(q.asOf);
  const list = useMemo(
    () =>
      stocks
        .filter((s) => {
          const q = market.quotes?.[s.id],
            cap = capToEur(s, q, market.fx);
          return (
            (!query ||
              `${s.name} ${s.challengeName} ${s.id} ${s.ticker} ${s.industry}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (!sector || s.sector === sector) &&
            (mode === "all" ||
              (mode === "watchlist" && watchlist.includes(s.id)) ||
              (mode === "review" && s.flags.includes("share-class")) ||
              (mode === "priced" && isNum(q?.price))) &&
            (!size ||
              (size === "small"
                ? between(cap, 0, 5e9)
                : size === "mid"
                  ? between(cap, 5e9, 20e9)
                  : size === "large"
                    ? between(cap, 20e9, 100e9)
                    : size === "mega"
                      ? between(cap, 100e9, 500e9)
                      : between(cap, 500e9))) &&
            (!momentum ||
              (fresh(q) &&
                (momentum === "1m-up"
                  ? q.return21 > 0
                  : momentum === "1m-down"
                    ? q.return21 < 0
                    : momentum === "3m-up"
                      ? q.return63 > 0
                      : momentum === "3m-down"
                        ? q.return63 < 0
                        : momentum === "3m-10"
                          ? q.return63 > 10
                          : momentum === "3m-minus-10"
                            ? q.return63 < -10
                            : momentum === "6m-up"
                              ? q.return126 > 0
                              : q.return126 < 0))) &&
            (!trend ||
              (fresh(q) &&
                (trend === "above-50"
                  ? q.aboveMa50 > 0
                  : trend === "below-50"
                    ? q.aboveMa50 < 0
                    : trend === "above-200"
                      ? q.aboveMa200 > 0
                      : trend === "below-200"
                        ? q.aboveMa200 < 0
                        : trend === "stacked"
                          ? q.aboveMa20 > 0 &&
                            q.ma20 > q.ma50 &&
                            q.ma50 > q.ma200
                          : trend === "golden"
                            ? isNum(q.ma200) && q.ma50 > q.ma200
                            : isNum(q.ma200) && q.ma50 < q.ma200))) &&
            (!valuation ||
              (valuation === "loss"
                ? isNum(q?.epsTrailing) && q.epsTrailing <= 0
                : valuation === "pe-15"
                  ? between(q?.pe, 0, 15)
                  : valuation === "pe-15-25"
                    ? between(q?.pe, 15, 25)
                    : valuation === "pe-25-40"
                      ? between(q?.pe, 25, 40)
                      : valuation === "pe-40"
                        ? between(q?.pe, 40)
                        : between(q?.forwardPe, 0, 20))) &&
            (!revenue ||
              (revenue === "neg"
                ? between(q?.revenueGrowth, -Infinity, 0)
                : between(q?.revenueGrowth, Number(revenue)))) &&
            (!eps ||
              (eps === "neg"
                ? between(q?.earningsGrowth, -Infinity, 0)
                : eps === "fwd-10"
                  ? between(q?.epsGrowthForward, 10)
                  : eps === "fwd-20"
                    ? between(q?.epsGrowthForward, 20)
                    : between(q?.earningsGrowth, Number(eps)))) &&
            (!dividend ||
              (dividend === "none"
                ? !positive(q?.dividendYield)
                : between(q?.dividendYield, Number(dividend)))) &&
            (!range ||
              (fresh(q) &&
                positive(q.high52) &&
                positive(q.low52) &&
                (range === "high-5"
                  ? q.price >= q.high52 * 0.95
                  : range === "high-10"
                    ? q.price >= q.high52 * 0.9
                    : range === "low-10"
                      ? q.price <= q.low52 * 1.1
                      : q.price <= q.high52 * 0.8)))
          );
        })
        .sort((a, b) => {
          const qa = market.quotes?.[a.id],
            qb = market.quotes?.[b.id];
          const val = (s, q) =>
            sort === "cap"
              ? capToEur(s, q, market.fx)
              : sort === "name"
                ? s.name
                : sort === "change"
                  ? q?.change
                  : sort === "momentum"
                    ? q?.return21
                    : sort === "momentum63"
                      ? q?.return63
                      : sort === "ma50"
                        ? q?.aboveMa50
                        : sort === "ma200"
                          ? q?.aboveMa200
                          : sort === "revenue"
                            ? q?.revenueGrowth
                            : sort === "eps"
                              ? q?.earningsGrowth
                              : sort === "volatility"
                                ? q?.volatility
                                : sort === "pe"
                                  ? q?.pe
                                  : s.name;
          const av = val(a, qa),
            bv = val(b, qb);
          if (av == null && bv == null) return a.name.localeCompare(b.name);
          if (av == null) return 1;
          if (bv == null) return -1;
          const result =
            typeof av === "string" ? av.localeCompare(bv) : av - bv;
          return direction === "asc" ? result : -result;
        }),
    [
      stocks,
      market,
      query,
      sector,
      mode,
      size,
      sort,
      direction,
      momentum,
      trend,
      valuation,
      revenue,
      eps,
      dividend,
      range,
      watchlist,
    ],
  );
  const pages = Math.max(1, Math.ceil(list.length / 20)),
    current = Math.min(page, pages),
    visible = list.slice((current - 1) * 20, current * 20);
  const sortBy = (key) => {
    setFilters({
      ...filters,
      sort: key,
      direction:
        sort === key && direction === "desc"
          ? "asc"
          : key === "name"
            ? "asc"
            : "desc",
    });
    setPage(1);
  };
  const exportRows = () =>
    download(
      "challenge-screen.csv",
      toCsv(
        list.map((s) => {
          const q = market.quotes?.[s.id];
          return {
            symbol: s.id,
            company: s.name,
            sector: s.sector,
            exchange: s.exchange,
            quote_currency: s.quoteCurrency,
            price: q?.price,
            price_as_of: q?.asOf,
            day_change_pct: q?.change,
            return_21_sessions_pct: q?.return21,
            return_63_sessions_pct: q?.return63,
            return_126_sessions_pct: q?.return126,
            vs_50_session_average_pct: q?.aboveMa50,
            vs_200_session_average_pct: q?.aboveMa200,
            annualized_volatility_pct: q?.volatility,
            trailing_pe: q?.pe,
            forward_pe: q?.forwardPe,
            revenue_growth_yoy_pct: q?.revenueGrowth,
            earnings_growth_yoy_pct: q?.earningsGrowth,
            eps_growth_forward_pct: q?.epsGrowthForward,
            dividend_yield_pct: q?.dividendYield,
            market_cap: q?.marketCap ?? s.marketCap,
            market_cap_currency: q?.marketCapCurrency || s.marketCapCurrency,
            market_cap_date: q?.marketCapAsOf || s.marketCapDate,
            market_cap_eur: capToEur(s, q, market.fx),
            fx_date: market.fx?.date,
            listing_status: s.listingStatus,
            notes: s.notes,
          };
        }),
      ),
    );
  const sortHead = (key, label, title) => (
    <th
      scope="col"
      aria-sort={
        sort === key
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button onClick={() => sortBy(key)} title={title}>
        {label}
        <Icon name="sort" size={12} />
      </button>
    </th>
  );
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">ELIGIBLE UNIVERSE</div>
          <h1>{stocks.length} stocks</h1>
          <p>
            Filter by sector, currency, exchange, market cap and momentum. Add
            candidates to the plan or the watchlist.
          </p>
        </div>
        <Button onClick={exportRows} disabled={!list.length}>
          <Icon name="download" /> Export screen
        </Button>
      </section>
      <div className="screen-tabs">
        {[
          ["all", "All stocks", stocks.length],
          ["watchlist", "Watchlist", watchlist.length],
          ["review", "Listing review", 11],
          ["priced", "With prices", Object.keys(market.quotes || {}).length],
        ].map(([id, label, count]) => (
          <button
            key={id}
            className={mode === id ? "active" : ""}
            onClick={() => update("mode", id)}
          >
            {id === "watchlist" && <Icon name="star" size={14} />} {label}{" "}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <section className="filter-panel" aria-label="Stock filters">
        <label className="search-field">
          <Icon name="search" />
          <input
            placeholder="Search company, ticker or industry…"
            aria-label="Search stocks"
            value={query}
            onChange={(e) => update("query", e.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => update("query", "")}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </label>
        <label>
          <span>Sector</span>
          <select
            aria-label="Sector"
            value={sector}
            onChange={(e) => update("sector", e.target.value)}
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Market cap · EUR</span>
          <select
            aria-label="Market cap in EUR"
            value={size}
            onChange={(e) => update("size", e.target.value)}
          >
            <option value="">Any size</option>
            <option value="small">Small · under €5bn</option>
            <option value="mid">Mid · €5–20bn</option>
            <option value="large">Large · €20–100bn</option>
            <option value="mega">Mega · €100–500bn</option>
            <option value="giant">Giant · €500bn+</option>
          </select>
        </label>
        <label>
          <span>Momentum</span>
          <select
            aria-label="Momentum"
            value={momentum}
            onChange={(e) => update("momentum", e.target.value)}
          >
            <option value="">Any</option>
            <option value="1m-up">1M positive</option>
            <option value="1m-down">1M negative</option>
            <option value="3m-up">3M positive</option>
            <option value="3m-down">3M negative</option>
            <option value="3m-10">3M above +10%</option>
            <option value="3m-minus-10">3M below −10%</option>
            <option value="6m-up">6M positive</option>
            <option value="6m-down">6M negative</option>
          </select>
        </label>
        <label>
          <span>Trend · moving averages</span>
          <select
            aria-label="Trend versus moving averages"
            value={trend}
            onChange={(e) => update("trend", e.target.value)}
          >
            <option value="">Any</option>
            <option value="above-50">Above 50-day</option>
            <option value="below-50">Below 50-day</option>
            <option value="above-200">Above 200-day</option>
            <option value="below-200">Below 200-day</option>
            <option value="golden">50-day above 200-day</option>
            <option value="death">50-day below 200-day</option>
            <option value="stacked">Price &gt; 20 &gt; 50 &gt; 200</option>
          </select>
        </label>
        <label>
          <span>Valuation</span>
          <select
            aria-label="Valuation"
            value={valuation}
            onChange={(e) => update("valuation", e.target.value)}
          >
            <option value="">Any</option>
            <option value="pe-15">P/E under 15</option>
            <option value="pe-15-25">P/E 15–25</option>
            <option value="pe-25-40">P/E 25–40</option>
            <option value="pe-40">P/E 40+</option>
            <option value="fwd-20">Forward P/E under 20</option>
            <option value="loss">Loss-making · no P/E</option>
          </select>
        </label>
        <label>
          <span>Revenue growth · YoY</span>
          <select
            aria-label="Revenue growth"
            value={revenue}
            onChange={(e) => update("revenue", e.target.value)}
          >
            <option value="">Any</option>
            <option value="0">Positive</option>
            <option value="10">Above 10%</option>
            <option value="20">Above 20%</option>
            <option value="30">Above 30%</option>
            <option value="neg">Shrinking</option>
          </select>
        </label>
        <label>
          <span>EPS growth</span>
          <select
            aria-label="EPS growth"
            value={eps}
            onChange={(e) => update("eps", e.target.value)}
          >
            <option value="">Any</option>
            <option value="0">YoY positive</option>
            <option value="10">YoY above 10%</option>
            <option value="20">YoY above 20%</option>
            <option value="30">YoY above 30%</option>
            <option value="neg">YoY shrinking</option>
            <option value="fwd-10">Forward est. above 10%</option>
            <option value="fwd-20">Forward est. above 20%</option>
          </select>
        </label>
        <label>
          <span>Dividend yield</span>
          <select
            aria-label="Dividend yield"
            value={dividend}
            onChange={(e) => update("dividend", e.target.value)}
          >
            <option value="">Any</option>
            <option value="0.01">Pays a dividend</option>
            <option value="2">Above 2%</option>
            <option value="4">Above 4%</option>
            <option value="none">No dividend</option>
          </select>
        </label>
        <label>
          <span>52-week range</span>
          <select
            aria-label="52-week range position"
            value={range}
            onChange={(e) => update("range", e.target.value)}
          >
            <option value="">Any</option>
            <option value="high-5">Within 5% of high</option>
            <option value="high-10">Within 10% of high</option>
            <option value="off-20">20%+ below high</option>
            <option value="low-10">Within 10% of low</option>
          </select>
        </label>
        <button className="text-link" onClick={reset}>
          Reset filters
        </button>
      </section>
      <div className="table-meta">
        <span>
          <strong>{list.length}</strong> of {stocks.length} stocks
          {sector && ` · ${sector}`}
        </span>
        <span>
          <span className="status-dot amber" />{" "}
          {Object.keys(market.quotes || {}).length
            ? "Quotes may be delayed; check timestamps"
            : "CSV snapshot · prices awaiting refresh"}
        </span>
      </div>
      {(sort === "cap" || size) && !market.fx?.date && (
        <div className="inline-note">
          <Icon name="info" size={15} /> Cap sorting and size filters use EUR.
          Foreign caps need FX data and are placed last or excluded by a size
          filter.
        </div>
      )}
      <div className="table-scroll">
        <table className="stock-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Watchlist</span>
              </th>
              {sortHead("name", "Company")}
              <th scope="col">Sector</th>
              <th scope="col" className="numeric">
                Last price
              </th>
              {sortHead("change", "1D %")}
              {sortHead(
                "momentum",
                "1M %",
                "21 trading sessions; adjusted-close returns when available",
              )}
              {sortHead("momentum63", "3M %", "63 trading sessions")}
              <th scope="col">30 sessions</th>
              {sortHead(
                "ma50",
                "vs 50d",
                "Last price versus the 50-session simple moving average",
              )}
              {sortHead(
                "ma200",
                "vs 200d",
                "Last price versus the 200-session simple moving average",
              )}
              {sortHead(
                "cap",
                "Market cap",
                "Sorts by EUR-converted market cap. Display retains the original currency.",
              )}
              {sortHead("pe", "P/E")}
              {sortHead(
                "revenue",
                "Rev. g",
                "Most recent quarter revenue growth, year over year",
              )}
              {sortHead(
                "eps",
                "EPS g",
                "Most recent quarter earnings growth, year over year",
              )}
              {sortHead(
                "volatility",
                "Vol. %",
                "Annualized standard deviation of 20 daily log returns",
              )}
              <th scope="col">
                <span className="sr-only">Add to portfolio</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const q = market.quotes?.[s.id],
                selected = draft.some((p) => p.id === s.id),
                watched = watchlist.includes(s.id);
              return (
                <tr key={s.id}>
                  <td>
                    <button
                      className={`icon-button star-button ${watched ? "selected" : ""}`}
                      aria-label={`${watched ? "Remove" : "Add"} ${s.name} ${watched ? "from" : "to"} watchlist`}
                      aria-pressed={watched}
                      onClick={() => toggleWatch(s.id)}
                    >
                      <Icon
                        name="star"
                        size={17}
                        fill={watched ? "currentColor" : "none"}
                      />
                    </button>
                  </td>
                  <td>
                    <button
                      className="company-cell"
                      onClick={() => openStock(s)}
                    >
                      <strong>
                        {s.name}{" "}
                        {s.flags.includes("share-class") && (
                          <span
                            title="Share class unconfirmed"
                            className="warning-mark"
                          >
                            !
                          </span>
                        )}
                      </strong>
                      <span>
                        {s.ticker} <span className="cell-dot">·</span>{" "}
                        {s.exchangeShort}
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="sector-label">{s.sector}</span>
                  </td>
                  <td className="numeric">
                    <span>{num(q?.price, 2)}</span>
                    <small>
                      {s.quoteCurrency}
                      {q?.asOf && ` · ${dateLabel(q.asOf)}`}
                      {q && stale(q.asOf) && " · stale"}
                    </small>
                  </td>
                  <td className="numeric">
                    <Change value={q?.change} />
                  </td>
                  <td className="numeric">
                    <Change value={q?.return21} />
                  </td>
                  <td className="numeric">
                    <Change value={q?.return63} />
                  </td>
                  <td>
                    <Sparkline
                      history={q?.spark}
                      label={`${s.name}: last 30 daily closes`}
                    />
                  </td>
                  <td className="numeric">
                    <Change value={q?.aboveMa50} />
                  </td>
                  <td className="numeric">
                    <Change value={q?.aboveMa200} />
                  </td>
                  <td className="numeric">
                    <span>{compact(q?.marketCap ?? s.marketCap)}</span>
                    <small
                      title={`${q?.marketCapAsOf || s.marketCapDate || "Missing date"} · ${s.marketCapPrecision}`}
                    >
                      {q?.marketCapCurrency || s.marketCapCurrency} ·{" "}
                      {dateLabel(q?.marketCapAsOf || s.marketCapDate)}
                    </small>
                  </td>
                  <td className="numeric">{num(q?.pe, 1)}</td>
                  <td className="numeric">
                    <Change value={q?.revenueGrowth} />
                  </td>
                  <td className="numeric">
                    <Change value={q?.earningsGrowth} />
                  </td>
                  <td className="numeric">
                    {isNum(q?.volatility) ? num(q.volatility, 1) : "—"}
                  </td>
                  <td>
                    <button
                      className={`icon-button add-button ${selected ? "selected" : ""}`}
                      disabled={selected}
                      aria-label={
                        selected
                          ? `${s.name} is in the plan`
                          : `Add ${s.name} to the plan`
                      }
                      onClick={() => addDraft(s.id)}
                    >
                      <Icon name={selected ? "check" : "plus"} size={17} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!list.length && (
        <Empty
          title="No stocks match this screen"
          icon="search"
          action={<Button onClick={reset}>Reset filters</Button>}
        >
          Widen the filters or clear the search.
        </Empty>
      )}
      <div className="pagination">
        <span>
          {list.length
            ? `${(current - 1) * 20 + 1}–${Math.min(current * 20, list.length)}`
            : "0"}{" "}
          of {list.length} results
        </span>
        <div>
          <Button
            aria-label="Previous page"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            <Icon
              name="chevron"
              style={{ transform: "rotate(180deg)" }}
              size={14}
            />
          </Button>
          <span>
            Page {current} of {pages}
          </span>
          <Button
            aria-label="Next page"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            <Icon name="chevron" size={14} />
          </Button>
        </div>
      </div>
      <p className="chart-footnote">
        Market caps retain their source currency; sorting and size bands use
        EUR when FX is available. 1M = 21, 3M = 63 and 6M = 126 trading
        sessions; moving averages are simple averages of daily closes. Revenue
        and EPS growth compare the latest reported quarter with the same quarter
        a year earlier, as returned by the provider. Missing values remain
        blank and never pass a numeric filter. A listing in this file does not
        confirm its share class in the competition.
      </p>
    </>
  );
}
