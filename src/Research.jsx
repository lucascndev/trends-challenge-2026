import React, { useEffect, useState } from "react";
import {
  Button,
  Icon,
  Tag,
  Change,
  Modal,
  Sparkline,
  num,
  compact,
  eur,
  dateLabel,
} from "./ui.jsx";
import { priceToEur, isNum, stale, START, END } from "../shared/finance.mjs";

export default function Research({
  stock,
  market,
  histories,
  loadHistory,
  close,
  watchlist,
  toggleWatch,
  draft,
  addDraft,
  notes,
  saveNote,
  addCompare,
}) {
  const [range, setRange] = useState(63);
  useEffect(() => {
    if (stock) void loadHistory([stock.id]);
  }, [stock, loadHistory]);
  if (!stock) return null;
  const s = stock,
    q = market.quotes?.[s.id],
    note = notes[s.id] || {};
  const history = (histories[s.id] || []).slice(-range);
  const inDraft = draft.some((p) => p.id === s.id),
    watched = watchlist.includes(s.id);
  const field = (key, value) => saveNote(s.id, { ...note, [key]: value });
  return (
    <Modal
      open={!!s}
      onClose={close}
      title={s.name}
      description={`${s.id} · ${s.exchange} · ${s.quoteCurrency}`}
      wide
    >
      <div className="research-actions">
        <Tag>{s.sector}</Tag>
        <span className="muted small">{s.industry}</span>
        <div className="push-right">
          <Button onClick={() => toggleWatch(s.id)}>
            <Icon name={watched ? "check" : "star"} size={15} />
            {watched ? "Watching" : "Watch"}
          </Button>
          <Button onClick={() => addCompare(s.id)}>Compare</Button>
          <Button
            variant="primary"
            disabled={inDraft}
            onClick={() => addDraft(s.id)}
          >
            <Icon name={inDraft ? "check" : "plus"} size={15} />
            {inDraft ? "In plan" : "Add to plan"}
          </Button>
        </div>
      </div>
      {s.flags.includes("share-class") && (
        <div className="warning-note">
          <Icon name="alert" />
          <span>
            <strong>Share class needs verification.</strong> {s.notes}
          </span>
        </div>
      )}
      <div className="research-grid">
        <div>
          <div className="quote-heading">
            <div>
              <span className="eyebrow">LAST QUOTE · {s.quoteCurrency}</span>
              <h2>
                {num(q?.price, 2)} <Change value={q?.change} />
              </h2>
              <p>
                {q?.asOf
                  ? `${dateLabel(q.asOf, true)} · ${new Date(q.asOf).toLocaleTimeString("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" })} Brussels${stale(q.asOf) ? " · Stale quote" : ""}`
                  : "Price not included in the source CSV"}
              </p>
            </div>
            <div className="segmented">
              {[
                [21, "1M"],
                [63, "3M"],
                [252, "1Y"],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={range === v ? "active" : ""}
                  onClick={() => setRange(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Sparkline
            history={history}
            large
            label={`${s.name}: daily closing prices in ${s.quoteCurrency}`}
          />
          {history.length > 1 && (
            <div className="chart-axis">
              <span>{dateLabel(history[0].date)}</span>
              <span>Daily close · {s.quoteCurrency}</span>
              <span>{dateLabel(history.at(-1).date)}</span>
            </div>
          )}
          <div className="metric-grid">
            <div>
              <span>5 sessions</span>
              <Change value={q?.return5} />
            </div>
            <div>
              <span>21 sessions</span>
              <Change value={q?.return21} />
            </div>
            <div>
              <span>63 sessions</span>
              <Change value={q?.return63} />
            </div>
            <div>
              <span>126 sessions</span>
              <Change value={q?.return126} />
            </div>
            <div>
              <span>vs 20-day average</span>
              <Change value={q?.aboveMa20} />
            </div>
            <div>
              <span>vs 50-day average</span>
              <Change value={q?.aboveMa50} />
            </div>
            <div>
              <span>vs 100-day average</span>
              <Change value={q?.aboveMa100} />
            </div>
            <div>
              <span>vs 200-day average</span>
              <Change value={q?.aboveMa200} />
            </div>
            <div>
              <span>Volatility · annualized</span>
              <strong>
                {isNum(q?.volatility) ? `${num(q.volatility, 1)}%` : "—"}
              </strong>
            </div>
            <div>
              <span>52-week low</span>
              <strong>{num(q?.low52, 2)}</strong>
            </div>
            <div>
              <span>52-week high</span>
              <strong>{num(q?.high52, 2)}</strong>
            </div>
            <div>
              <span>20-session avg. volume</span>
              <strong>{compact(q?.volume20)}</strong>
            </div>
            <div>
              <span>From 1-year close high</span>
              <Change value={q?.drawdown} />
            </div>
          </div>
          <p className="chart-footnote">
            Returns use{" "}
            {q?.returnBasis?.toLowerCase() || "adjusted closes when available"}{" "}
            in local quote currency. Volatility uses 20 daily log returns and
            252 sessions per year.
          </p>
        </div>
        <aside className="fundamentals">
          <h3>Company snapshot</h3>
          <dl>
            <div>
              <dt>Market cap</dt>
              <dd>
                {compact(q?.marketCap ?? s.marketCap)}{" "}
                <small>{q?.marketCapCurrency || s.marketCapCurrency}</small>
              </dd>
            </div>
            <div>
              <dt>Cap source date</dt>
              <dd>{dateLabel(q?.marketCapAsOf || s.marketCapDate, true)}</dd>
            </div>
            <div>
              <dt>Trailing P/E</dt>
              <dd>{num(q?.pe, 1)}</dd>
            </div>
            <div>
              <dt>Fundamentals as of</dt>
              <dd>{dateLabel(q?.fundamentalsAsOf, true)}</dd>
            </div>
            <div>
              <dt>Forward P/E</dt>
              <dd>{num(q?.forwardPe, 1)}</dd>
            </div>
            <div>
              <dt>Trailing dividend yield</dt>
              <dd>
                {isNum(q?.dividendYield) ? `${num(q.dividendYield, 2)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt>Revenue growth · YoY quarter</dt>
              <dd>
                <Change value={q?.revenueGrowth} />
              </dd>
            </div>
            <div>
              <dt>Earnings growth · YoY quarter</dt>
              <dd>
                <Change value={q?.earningsGrowth} />
              </dd>
            </div>
            <div>
              <dt>EPS trailing → forward</dt>
              <dd>
                {isNum(q?.epsTrailing) && isNum(q?.epsForward)
                  ? `${num(q.epsTrailing, 2)} → ${num(q.epsForward, 2)}`
                  : "—"}
                {isNum(q?.epsGrowthForward) && (
                  <>
                    {" "}
                    (<Change value={q.epsGrowthForward} />)
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Net margin · ROE</dt>
              <dd>
                {isNum(q?.profitMargin) ? `${num(q.profitMargin, 1)}%` : "—"}
                {" · "}
                {isNum(q?.returnOnEquity)
                  ? `${num(q.returnOnEquity, 1)}%`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Price in EUR</dt>
              <dd>{eur(priceToEur(q?.price, s, market.fx), 2)}</dd>
            </div>
            <div>
              <dt>FX reference date</dt>
              <dd>
                {s.currency === "EUR"
                  ? "Not needed"
                  : dateLabel(market.fx?.date)}
              </dd>
            </div>
            <div>
              <dt>Provider quote delay</dt>
              <dd>
                {isNum(q?.quoteDelayMinutes)
                  ? `${q.quoteDelayMinutes} min`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Next earnings</dt>
              <dd>
                {dateLabel(q?.earningsDate)}
                {q?.earningsDate && (
                  <small>
                    {q.earningsEstimated
                      ? "Estimated · verify with issuer"
                      : "Provider reported · verify"}
                  </small>
                )}
              </dd>
            </div>
          </dl>
          {q?.earningsDate &&
            q.earningsDate >= START &&
            q.earningsDate <= END && (
              <Tag tone="amber">Earnings inside the competition</Tag>
            )}
          {s.quoteScale === 0.01 && (
            <p className="quiet-note">
              London price is in pence. 100 GBp = £1. Market cap is already in
              GBP.
            </p>
          )}
          <a
            className="text-link"
            href={s.sources.quote}
            target="_blank"
            rel="noreferrer"
          >
            Open quote & company news <Icon name="external" size={14} />
          </a>
        </aside>
      </div>
      <section className="research-notes">
        <div>
          <h3>Notes</h3>
          <p className="muted small">Saved in this browser.</p>
        </div>
        <div className="notes-grid">
          <label>
            Why this stock?
            <textarea
              rows="3"
              value={note.thesis || ""}
              placeholder="Thesis"
              onChange={(e) => field("thesis", e.target.value)}
            />
          </label>
          <label>
            Catalyst & exit conditions
            <textarea
              rows="3"
              value={note.catalyst || ""}
              placeholder="Catalyst, exit condition"
              onChange={(e) => field("catalyst", e.target.value)}
            />
          </label>
          <label>
            Review date
            <input
              type="date"
              value={note.reviewDate || ""}
              onChange={(e) => field("reviewDate", e.target.value)}
            />
          </label>
        </div>

      </section>
      <details className="source-details">
        <summary>Listing provenance & source notes</summary>
        <dl>
          <div>
            <dt>Challenge entry</dt>
            <dd>{s.challengeName}</dd>
          </div>
          <div>
            <dt>Listing status from CSV</dt>
            <dd>{s.listingStatus}</dd>
          </div>
          <div>
            <dt>Challenge sector</dt>
            <dd>{s.challengeSector}</dd>
          </div>
          <div>
            <dt>Cap precision / date basis</dt>
            <dd>
              {s.marketCapPrecision} · {s.marketCapDateBasis}
            </dd>
          </div>
          <div>
            <dt>Original source row</dt>
            <dd>{s.sourceRow}</dd>
          </div>
        </dl>
        {s.notes && <p>{s.notes}</p>}
        {s.alternatives && (
          <p>Alternative symbols from source: {s.alternatives}</p>
        )}
        <div className="source-links">
          {Object.entries(s.sources)
            .filter(([, url]) => url)
            .map(([key, url]) => (
              <a href={url} target="_blank" rel="noreferrer" key={key}>
                {key} <Icon name="external" size={12} />
              </a>
            ))}
        </div>
      </details>
    </Modal>
  );
}
