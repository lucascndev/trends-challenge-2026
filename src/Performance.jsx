import React, { useEffect, useMemo } from "react";
import { Button, Icon, SectionHead, Empty, Change, num, eur, pct, dateLabel } from "./ui.jsx";
import {
  CAPITAL,
  START,
  END,
  MIN_POSITIONS,
  MAX_WEIGHT,
  day,
  phase,
  isNum,
  stale,
  priceToEur,
  validateDraft,
  valuePortfolio,
  portfolioSeries,
  draftSeries,
  sinceAdded,
} from "../shared/finance.mjs";

// Value line with the €100,000 baseline; complete points are solid, estimates hollow.
function ValueChart({ points, label }) {
  const values = points.map((p) => p.value);
  if (values.length < 2)
    return (
      <Empty title="Not enough sessions yet" icon="chart">
        The curve appears once two priced sessions are available.
      </Empty>
    );
  const w = 760,
    h = 240,
    pad = { top: 14, right: 64, bottom: 8, left: 8 };
  const low = Math.min(...values, CAPITAL),
    high = Math.max(...values, CAPITAL),
    range = high - low || CAPITAL * 0.01;
  const x = (i) => pad.left + (i * (w - pad.left - pad.right)) / (values.length - 1);
  const y = (v) => pad.top + ((high - v) * (h - pad.top - pad.bottom)) / range;
  const path = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const last = values.at(-1);
  const tone = last >= CAPITAL ? "#14655b" : "#ab493e";
  return (
    <svg
      className="price-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <title>{label}</title>
      {[high, CAPITAL, low].map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={w - pad.right}
            y1={y(v)}
            y2={y(v)}
            stroke={v === CAPITAL ? "#8a857b" : "#ddd8ce"}
            strokeDasharray={v === CAPITAL ? "" : "3 5"}
          />
          <text x={w - pad.right + 6} y={y(v) + 4} fontSize="11" fill="#6b665e">
            {eur(v)}
          </text>
        </g>
      ))}
      <path
        d={`${path} L${x(values.length - 1)},${y(CAPITAL)} L${x(0)},${y(CAPITAL)} Z`}
        fill={tone}
        opacity=".07"
      />
      <path d={path} stroke={tone} strokeWidth="2.2" fill="none" vectorEffect="non-scaling-stroke" />
      {points.map(
        (p, i) =>
          !p.complete && (
            <circle key={p.date} cx={x(i)} cy={y(p.value)} r="2.6" fill="#fff" stroke={tone} />
          ),
      )}
      <circle cx={x(values.length - 1)} cy={y(last)} r="3.4" fill={tone} />
    </svg>
  );
}

export default function Performance({
  stocks,
  market,
  histories,
  loadHistory,
  draft,
  trades,
  navigate,
  openStock,
  refresh,
  busy,
}) {
  const today = day(),
    status = phase(today);
  const live = trades.length > 0;
  const ids = useMemo(
    () => [...new Set([...draft.map((p) => p.id), ...trades.map((t) => t.id)])],
    [draft, trades],
  );
  useEffect(() => {
    if (ids.length) void loadHistory(ids);
  }, [ids, loadHistory]);
  const loaded = ids.every((id) => id in histories);
  const book = useMemo(
    () => (live ? valuePortfolio(trades, stocks, market, today) : null),
    [live, trades, stocks, market, today],
  );
  const plan = validateDraft(draft);
  const series = useMemo(
    () =>
      !loaded
        ? []
        : live
          ? portfolioSeries(trades, stocks, histories, market.fx, today)
          : draftSeries(draft, stocks, histories, market.fx, today),
    [loaded, live, trades, draft, stocks, histories, market.fx, today],
  );
  const byId = Object.fromEntries(stocks.map((s) => [s.id, s]));
  // Rows: live holdings marked to market, or the plan priced at the latest quote.
  const rows = live
    ? book.holdings.map((h) => {
        const s = byId[h.id],
          q = market.quotes?.[h.id];
        return {
          s,
          q,
          shares: h.shares,
          cost: h.cost,
          value: h.value,
          pnl: h.pnl,
          weight: isNum(h.value) && isNum(book.value) ? (h.value / book.value) * 100 : null,
        };
      })
    : draft.map((p) => {
        const s = byId[p.id],
          q = market.quotes?.[p.id],
          price = priceToEur(q?.price, s, market.fx);
        return {
          s,
          q,
          weight: p.weight,
          added: p.added,
          since: sinceAdded(p, s, histories[p.id], market.fx),
          budget: (CAPITAL * p.weight) / 100,
          shares: price ? Math.floor((CAPITAL * p.weight) / 100 / price) : null,
        };
      });
  const exposure = (key) =>
    Object.entries(
      rows.reduce((a, r) => {
        const k = key(r.s);
        a[k] = (a[k] || 0) + (r.weight || 0);
        return a;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);
  const over = rows.filter((r) => isNum(r.weight) && r.weight > MAX_WEIGHT + 1e-9);
  const first = series.find((p) => p.complete) || series[0],
    last = series.at(-1);
  // Weighted return since each stock's add date, on the whole €100,000.
  const planSince =
    !live && rows.some((r) => isNum(r.since))
      ? rows.reduce(
          (sum, r) => sum + (isNum(r.since) ? (r.since * r.weight) / 100 : 0),
          0,
        )
      : null;
  const firstAdded = draft.map((p) => p.added).filter(Boolean).sort()[0];
  return (
    <>
      <section className="page-intro">
        <div>
          <span className="eyebrow">
            {status.label === "Preparation"
              ? `COMPETITION OPENS ${dateLabel(START).toUpperCase()} · ${status.days} DAYS`
              : status.label === "Finished"
                ? "COMPETITION CLOSED 27 NOVEMBER 2026"
                : `WEEK ${status.week} OF 8 · ${status.days} DAYS TO ${dateLabel(END).toUpperCase()}`}
          </span>
          <h1>{live ? "Portfolio performance" : "Planned portfolio"}</h1>
          <p>
            {live
              ? "Journal positions marked at the latest close and ECB reference rates, in EUR."
              : draft.length
                ? "The plan measured from the day each stock was added, at daily closes and ECB rates. From 5 October the journal takes over."
                : "No plan yet. Add 5–20 stocks from the screener."}
          </p>
        </div>
        <div className="button-row">
          {ids.length > 0 && (
            <Button onClick={refresh} disabled={busy}>
              <Icon name="refresh" size={15} /> Refresh my prices
            </Button>
          )}
          <Button variant="primary" onClick={() => navigate(draft.length ? "portfolio" : "screener")}>
            {draft.length ? "Edit plan" : "Open screener"} <Icon name="arrow" size={15} />
          </Button>
        </div>
      </section>
      {!ids.length ? (
        <Empty
          title="Nothing to track yet"
          icon="wallet"
          action={
            <Button variant="primary" onClick={() => navigate("screener")}>
              Open screener <Icon name="arrow" size={15} />
            </Button>
          }
        >
          Rules: €100,000, 5 to 20 stocks, no stock above 25% of capital, long only.
        </Empty>
      ) : (
        <>
          <section className="portfolio-stats">
            {live ? (
              <>
                <div>
                  <span className="eyebrow">PORTFOLIO VALUE</span>
                  <strong>{eur(book.value)}</strong>
                  <span>
                    {book.missing.length
                      ? `No price for ${book.missing.join(", ")}`
                      : book.outdated.length
                        ? "Includes stale quotes or FX"
                        : "Cash + holdings at last close"}
                  </span>
                </div>
                <div>
                  <span className="eyebrow">RETURN</span>
                  <strong className={isNum(book.value) && book.value >= CAPITAL ? "positive" : "negative"}>
                    {isNum(book.value) ? pct((book.value / CAPITAL - 1) * 100) : "—"}
                  </strong>
                  <span>On €100,000 · after entered fees</span>
                </div>
                <div>
                  <span className="eyebrow">CASH</span>
                  <strong>{eur(book.cash, 2)}</strong>
                  <span>{num((book.cash / (book.value || CAPITAL)) * 100, 1)}% of value</span>
                </div>
                <div>
                  <span className="eyebrow">REALIZED</span>
                  <strong>{eur(book.realized, 2)}</strong>
                  <span>{eur(book.fees, 2)} fees · {book.holdings.length} holdings</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="eyebrow">PLANNED</span>
                  <strong>{eur((CAPITAL * plan.total) / 100)}</strong>
                  <span>{num(plan.total, 2)}% of capital</span>
                </div>
                <div>
                  <span className="eyebrow">CASH</span>
                  <strong className={plan.cash < 0 ? "negative" : ""}>{eur(plan.cash)}</strong>
                  <span>{num(100 - plan.total, 2)}% unallocated</span>
                </div>
                <div>
                  <span className="eyebrow">POSITIONS</span>
                  <strong>
                    {draft.length}
                    <small> / 20</small>
                  </strong>
                  <span>
                    {plan.valid ? "Plan meets the rules" : plan.issues[0]}
                  </span>
                </div>
                <div>
                  <span className="eyebrow">SINCE ADDED</span>
                  <strong className={isNum(planSince) && planSince < 0 ? "negative" : "positive"}>
                    {pct(planSince)}
                  </strong>
                  <span>
                    {firstAdded ? `On €100,000 · first pick ${dateLabel(firstAdded)}` : "—"}
                  </span>
                </div>
              </>
            )}
          </section>
          {live && book.missing.length > 0 && (
            <div className="warning-note">
              <Icon name="alert" />
              Valuation is incomplete: no quote or FX for {book.missing.join(", ")}.
            </div>
          )}
          {live && book.outdated.length > 0 && (
            <div className="warning-note">
              <Icon name="clock" />
              Stale inputs for {book.outdated.join(", ")}. Refresh before reading the numbers.
            </div>
          )}
          {over.length > 0 && (
            <div className="warning-note">
              <Icon name="alert" />
              Above the {MAX_WEIGHT}% limit: {over.map((r) => `${r.s.id} ${num(r.weight, 1)}%`).join(", ")}
              {live ? " (at market value)." : "."}
            </div>
          )}
          {live && book.holdings.length < MIN_POSITIONS && (
            <div className="warning-note">
              <Icon name="alert" />
              {book.holdings.length} holding{book.holdings.length === 1 ? "" : "s"}; the challenge requires at least {MIN_POSITIONS}.
            </div>
          )}
          <div className="journal-chart">
            <SectionHead
              title={live ? "Daily value since the first trade" : "Plan value since the first pick"}
            >
              {first && last && (
                <span className="chart-summary">
                  {dateLabel(first.date)} → {dateLabel(last.date)} ·{" "}
                  <Change value={(last.value / first.value - 1) * 100} />
                </span>
              )}
            </SectionHead>
            {!loaded ? (
              <p className="muted small">Loading price histories…</p>
            ) : (
              <ValueChart
                points={series}
                label={live ? "Portfolio value in EUR per session" : "Planned portfolio value in EUR per session"}
              />
            )}
            <p className="chart-footnote">
              {live
                ? "Cash plus holdings at each session's close and the ECB rate of that day. Hollow points mark sessions where a close or FX rate was missing."
                : "Each stock enters at the close of the day it was added, at its current weight; the rest stays in cash. Changing a weight re-prices the whole curve. Hollow points mark sessions with a missing close or FX rate."}
            </p>
          </div>
          <SectionHead title={live ? "Holdings" : "Planned positions"} />
          <div className="table-scroll">
            <table className="allocation-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="numeric">Weight</th>
                  <th className="numeric">{live ? "Shares" : "Est. shares"}</th>
                  <th className="numeric">{live ? "Cost · EUR" : "Budget · EUR"}</th>
                  <th className="numeric">{live ? "Value · EUR" : "Price"}</th>
                  <th className="numeric">Day</th>
                  <th className="numeric">21 sessions</th>
                  <th className="numeric">{live ? "P&L · EUR" : "Since added"}</th>
                  <th>Next earnings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.id}>
                    <td>
                      <button className="company-cell" onClick={() => openStock(r.s)}>
                        <strong>{r.s.name}</strong>
                        <span>
                          {r.s.id} · {r.s.currency}
                          {r.q?.asOf && stale(r.q.asOf, today) ? " · stale" : ""}
                        </span>
                      </button>
                    </td>
                    <td className={`numeric ${isNum(r.weight) && r.weight > MAX_WEIGHT ? "negative" : ""}`}>
                      {isNum(r.weight) ? `${num(r.weight, 1)}%` : "—"}
                    </td>
                    <td className="numeric">{num(r.shares, live ? 2 : 0)}</td>
                    <td className="numeric">{eur(live ? r.cost : r.budget)}</td>
                    <td className="numeric">
                      {live ? eur(r.value) : `${num(r.q?.price, 2)} ${r.s.quoteCurrency}`}
                    </td>
                    <td className="numeric">
                      <Change value={r.q?.change} />
                    </td>
                    <td className="numeric">
                      <Change value={r.q?.return21} />
                    </td>
                    <td className={`numeric ${live ? (r.pnl >= 0 ? "positive" : "negative") : ""}`}>
                      {live ? (
                        eur(r.pnl)
                      ) : (
                        <>
                          <Change value={r.since} />
                          <small className="muted"> {dateLabel(r.added)}</small>
                        </>
                      )}
                    </td>
                    <td className="small">
                      {r.q?.earningsDate
                        ? `${dateLabel(r.q.earningsDate)}${r.q.earningsEstimated ? " (est.)" : ""}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="exposure-grid">
            {[
              ["Sector", exposure((s) => s.sector)],
              ["Currency", exposure((s) => s.currency)],
            ].map(([title, entries]) => (
              <div className="exposure-panel" key={title}>
                <h3>{title}</h3>
                {entries.map(([k, v]) => (
                  <div className="exposure-row" key={k}>
                    <div>
                      <span>{k}</span>
                      <strong>{num(v, 1)}%</strong>
                    </div>
                    <div className="bar-track">
                      <span style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
