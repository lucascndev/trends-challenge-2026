import React, { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  Button,
  Icon,
  SectionHead,
  Tag,
  Empty,
  Modal,
  num,
  eur,
  pct,
  dateLabel,
  download,
} from "./ui.jsx";
import {
  CAPITAL,
  START,
  END,
  MIN_POSITIONS,
  MAX_POSITIONS,
  MAX_WEIGHT,
  day,
  validateDraft,
  equalWeight,
  priceToEur,
  valuePortfolio,
  validateTrade,
  isNum,
  stale,
} from "../shared/finance.mjs";
import { toCsv } from "../shared/csv.mjs";

export default function Portfolio({
  stocks,
  market,
  draft,
  setDraft,
  trades,
  setTrades,
  notes,
  navigate,
  openStock,
  notify,
  backup,
  restore,
}) {
  const [view, setView] = useState("plan"),
    [tradeOpen, setTradeOpen] = useState(false),
    [removeOpen, setRemoveOpen] = useState(false),
    [error, setError] = useState("");
  const initial = {
    id: draft[0]?.id || stocks[0]?.id || "",
    type: "buy",
    shares: "",
    price: "",
    fx: "",
    fee: "0",
    date: day() < START ? START : day() > END ? END : day(),
    listingChecked: false,
    note: "",
    ratio: "",
    amount: "",
  };
  const [form, setForm] = useState(initial);
  const validation = validateDraft(draft),
    book = valuePortfolio(trades, stocks, market);
  const stock = stocks.find((s) => s.id === form.id);
  const allocated = (CAPITAL * validation.total) / 100;
  const sectors = draft.reduce((a, p) => {
    const s = stocks.find((s) => s.id === p.id);
    if (s) a[s.sector] = (a[s.sector] || 0) + p.weight;
    return a;
  }, {});
  const foreign = draft.reduce(
    (sum, p) =>
      sum +
      (stocks.find((s) => s.id === p.id)?.currency !== "EUR" ? p.weight : 0),
    0,
  );
  const largest = draft.reduce(
    (m, p) => (isNum(p.weight) && p.weight > m ? p.weight : m),
    0,
  );
  const updateWeight = (id, value) =>
    setDraft(
      draft.map((p) => (p.id === id ? { ...p, weight: Number(value) } : p)),
    );
  const updateAdded = (id, value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value <= day() &&
    setDraft(draft.map((p) => (p.id === id ? { ...p, added: value } : p)));
  function openTrade(id) {
    const selected =
      stocks.find((s) => s.id === (id || draft[0]?.id)) || stocks[0];
    setForm({
      ...initial,
      id: selected.id,
      fx: selected.currency === "EUR" ? "1" : "",
      price: "",
    });
    setError("");
    setTradeOpen(true);
  }
  function submit(e) {
    e.preventDefault();
    const entry = {
      ...form,
      shares: Number(form.shares),
      price: Number(form.price),
      fx: stock?.currency === "EUR" ? 1 : Number(form.fx),
      fee: Number(form.fee),
      amount: Number(form.amount),
      ratio: Number(form.ratio),
      sequence: trades.length
        ? Math.max(...trades.map((t) => t.sequence)) + 1
        : 1,
    };
    const issue = validateTrade(entry, trades, stocks);
    if (issue) {
      setError(issue);
      return;
    }
    setTrades([...trades, entry]);
    setTradeOpen(false);
    notify("Journal entry saved.");
  }
  const exportDraft = () =>
    download(
      "challenge-allocation-plan.csv",
      toCsv(
        draft.map((p) => {
          const s = stocks.find((s) => s.id === p.id),
            q = market.quotes?.[p.id],
            price = priceToEur(q?.price, s, market.fx);
          return {
            symbol: s.id,
            company: s.name,
            target_weight_pct: p.weight,
            target_eur: (CAPITAL * p.weight) / 100,
            estimated_whole_shares: price
              ? Math.floor((CAPITAL * p.weight) / 100 / price)
              : null,
            quote_currency: s.quoteCurrency,
            quote_as_of: q?.asOf,
            fx_date: market.fx?.date,
            listing_status: s.listingStatus,
            thesis: notes[s.id]?.thesis,
            catalyst: notes[s.id]?.catalyst,
          };
        }),
      ),
    );
  const formUpdate = (key, value) => {
    setForm({ ...form, [key]: value });
    setError("");
  };
  return (
    <>
      <section className="page-intro">
        <div>
          <span className="eyebrow">
            €100,000 · {MIN_POSITIONS}–{MAX_POSITIONS} STOCKS · MAX {MAX_WEIGHT}% EACH · LONG ONLY
          </span>
          <h1>Plan and journal</h1>
          <p>
            Set target weights before 5 October, then record the actual fills
            from the challenge account.
          </p>
        </div>
        <Button
          onClick={
            view === "plan"
              ? exportDraft
              : () => download("challenge-trade-journal.csv", toCsv(trades))
          }
          disabled={view === "plan" ? !draft.length : !trades.length}
        >
          <Icon name="download" /> Export {view === "plan" ? "plan" : "journal"}
        </Button>
      </section>
      <div className="screen-tabs">
        <button
          className={view === "plan" ? "active" : ""}
          onClick={() => setView("plan")}
        >
          Allocation plan <span>{draft.length}</span>
        </button>
        <button
          className={view === "journal" ? "active" : ""}
          onClick={() => setView("journal")}
        >
          Trade journal <span>{trades.length}</span>
        </button>
        <span className="tabs-note">Saved in this browser</span>
      </div>
      {view === "plan" ? (
        <>
          <section className="portfolio-stats">
            <div>
              <span className="eyebrow">TARGET ALLOCATION</span>
              <strong>{eur(allocated)}</strong>
              <span>{num(validation.total, 2)}% of starting capital</span>
            </div>
            <div>
              <span className="eyebrow">CASH RESERVE</span>
              <strong className={validation.cash < 0 ? "negative" : ""}>
                {eur(validation.cash)}
              </strong>
              <span>{num(100 - validation.total, 2)}% unallocated</span>
            </div>
            <div>
              <span className="eyebrow">POSITIONS</span>
              <strong>
                {draft.length}
                <small> / 20</small>
              </strong>
              <span>{MIN_POSITIONS} minimum · {MAX_POSITIONS} maximum</span>
            </div>
            <div>
              <span className="eyebrow">LARGEST POSITION</span>
              <strong className={largest > MAX_WEIGHT ? "negative" : ""}>
                {num(largest, 1)}%
              </strong>
              <span>Limit {MAX_WEIGHT}% · {num(foreign, 1)}% in foreign currency</span>
            </div>
          </section>
          <div className="portfolio-layout">
            <section>
              <SectionHead title="Target weights">
                <div className="button-row">
                  <Button
                    disabled={!draft.length}
                    onClick={() => setDraft(equalWeight(draft))}
                  >
                    Equal weight
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => navigate("screener")}
                  >
                    <Icon name="plus" size={15} /> Add stocks
                  </Button>
                </div>
              </SectionHead>
              {draft.length ? (
                <>
                  <div className="table-scroll">
                    <table className="allocation-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th className="numeric">Target %</th>
                          <th className="numeric">Budget · EUR</th>
                          <th className="numeric">Est. shares</th>
                          <th>Added</th>
                          <th>
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.map((p) => {
                          const s = stocks.find((s) => s.id === p.id),
                            q = market.quotes?.[p.id],
                            price = priceToEur(q?.price, s, market.fx);
                          return (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="company-cell"
                                  onClick={() => openStock(s)}
                                >
                                  <strong>
                                    {s.name}
                                    {s.flags.includes("share-class") && (
                                      <span
                                        className="warning-mark"
                                        title="Share class unconfirmed"
                                      >
                                        !
                                      </span>
                                    )}
                                  </strong>
                                  <span>
                                    {s.id} · {s.currency}
                                    {s.quoteScale === 0.01
                                      ? " (pence quote)"
                                      : ""}
                                  </span>
                                </button>
                              </td>
                              <td
                                className={`numeric ${isNum(p.weight) && p.weight > MAX_WEIGHT ? "negative" : ""}`}
                              >
                                <input
                                  className="weight-input"
                                  aria-label={`${s.name} allocation percent`}
                                  type="number"
                                  min="0.01"
                                  max={MAX_WEIGHT}
                                  step="0.01"
                                  value={p.weight}
                                  onChange={(e) =>
                                    updateWeight(p.id, e.target.value)
                                  }
                                />
                              </td>
                              <td className="numeric">
                                {eur((CAPITAL * p.weight) / 100)}
                              </td>
                              <td
                                className="numeric"
                                title={
                                  price
                                    ? "Whole shares at the latest available price. Excludes fees; review quote and FX timestamps."
                                    : "A price and FX rate are required."
                                }
                              >
                                {price
                                  ? num(
                                      Math.floor(
                                        (CAPITAL * p.weight) / 100 / price,
                                      ),
                                    )
                                  : "—"}
                                {price &&
                                  (stale(q.asOf) ||
                                    (s.currency !== "EUR" &&
                                      stale(market.fx?.date))) && (
                                    <small>stale inputs</small>
                                  )}
                              </td>
                              <td>
                                <input
                                  className="date-input"
                                  type="date"
                                  aria-label={`${s.name} added on`}
                                  max={day()}
                                  value={p.added || ""}
                                  onChange={(e) =>
                                    updateAdded(p.id, e.target.value)
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove ${s.name} from draft`}
                                  onClick={() =>
                                    setDraft(draft.filter((x) => x.id !== p.id))
                                  }
                                >
                                  <Icon name="close" size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="inline-note">
                    <Icon name="info" size={15} /> Estimated shares use the
                    latest close and ECB rate, whole shares, no fees. The
                    Performance page measures each stock from the close of the
                    day it was added; edit the date to backdate a pick.
                  </div>
                </>
              ) : (
                <Empty
                  title="No stocks in the plan"
                  icon="wallet"
                  action={
                    <Button
                      variant="primary"
                      onClick={() => navigate("screener")}
                    >
                      Open screener <Icon name="arrow" size={15} />
                    </Button>
                  }
                >
                  Add {MIN_POSITIONS}–{MAX_POSITIONS} stocks from the screener
                  and set a weight for each, at most {MAX_WEIGHT}%.
                </Empty>
              )}
            </section>
            <aside>
              <div className="allocation-check">
                <span className="eyebrow">RULE CHECK</span>
                <h3>
                  {validation.valid
                    ? "The plan meets the rules."
                    : "The plan does not meet the rules yet."}
                </h3>
                {validation.issues.map((e) => (
                  <p className="check-item" key={e}>
                    <Icon name="info" size={15} />
                    {e}
                  </p>
                ))}
                {validation.valid && (
                  <p className="check-item positive">
                    <Icon name="check" size={16} />
                    {draft.length} positions · {num(validation.total, 2)}%
                    invested
                  </p>
                )}
                {draft.some((p) =>
                  stocks
                    .find((s) => s.id === p.id)
                    ?.flags.includes("share-class"),
                ) && (
                  <p className="check-item amber-text">
                    <Icon name="alert" size={15} />
                    Some share classes are unconfirmed; check them in the
                    challenge account.
                  </p>
                )}
                <p className="muted small">
                  Rules applied: {MIN_POSITIONS}–{MAX_POSITIONS} stocks, no
                  stock above {MAX_WEIGHT}% of capital, total at most 100%,
                  long only.
                </p>
              </div>
              <div className="allocation-check">
                <span className="eyebrow">BACKUP</span>
                <p className="muted small">
                  Plan, watchlist, notes and journal are stored in this browser
                  only. Keep a copy.
                </p>
                <div className="stack-buttons">
                  <Button onClick={backup}>
                    <Icon name="download" size={15} /> Download backup
                  </Button>
                  <label className="button button-secondary import-button">
                    Restore a backup
                    <input
                      type="file"
                      accept=".json,application/json"
                      aria-label="Restore portfolio backup"
                      onChange={(e) => {
                        if (e.target.files?.[0]) restore(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="exposure-panel">
                <h3>Sector exposure</h3>
                {Object.entries(sectors)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, v]) => (
                    <div className="exposure-row" key={s}>
                      <div>
                        <span>{s}</span>
                        <strong>{num(v, 1)}%</strong>
                      </div>
                      <div className="bar-track">
                        <span
                          style={{ width: `${Math.min(100, Math.max(0, v))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                {!draft.length && (
                  <p className="muted small">No positions yet.</p>
                )}
              </div>
            </aside>
          </div>
        </>
      ) : (
        <>
          {book.missing.length > 0 && (
            <div className="warning-note">
              <Icon name="alert" />
              No quote or FX for {book.missing.join(", ")}; values below are
              incomplete.
            </div>
          )}
          <SectionHead title="Current holdings">
            <Button
              variant="primary"
              onClick={() => openTrade()}
              disabled={day() < START}
            >
              <Icon name="plus" size={15} /> Record execution
            </Button>
          </SectionHead>
          {day() < START && (
            <div className="inline-note">
              <Icon name="clock" size={15} />
              The competition opens on 5 October. Executions can be recorded
              from that date.
            </div>
          )}
          {book.holdings.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="numeric">Shares</th>
                    <th className="numeric">Cost · EUR</th>
                    <th className="numeric">Value · EUR</th>
                    <th className="numeric">Unrealized P&L</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {book.holdings.map((h) => {
                    const s = stocks.find((s) => s.id === h.id);
                    return (
                      <tr key={h.id}>
                        <td>
                          <button
                            className="company-cell"
                            onClick={() => openStock(s)}
                          >
                            <strong>{s.name}</strong>
                            <span>{s.id}</span>
                          </button>
                        </td>
                        <td className="numeric">{num(h.shares, 2)}</td>
                        <td className="numeric">{eur(h.cost, 2)}</td>
                        <td className="numeric">{eur(h.value, 2)}</td>
                        <td
                          className={`numeric ${h.pnl >= 0 ? "positive" : "negative"}`}
                        >
                          {eur(h.pnl, 2)}
                        </td>
                        <td>
                          <Button onClick={() => openTrade(h.id)}>
                            Record trade
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted journal-empty">
              No executions recorded. Cash: {eur(book.cash, 2)}.
            </p>
          )}
          {book.holdings.length > 0 && book.holdings.length < MIN_POSITIONS && (
            <p className="amber-text small">
              {book.holdings.length} holding
              {book.holdings.length === 1 ? "" : "s"}; the challenge requires
              at least {MIN_POSITIONS}.
            </p>
          )}
          <SectionHead title="Trade journal">
            <Button
              disabled={!trades.length}
              onClick={() => setRemoveOpen(true)}
            >
              <Icon name="undo" size={15} /> Undo latest entry
            </Button>
          </SectionHead>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Stock</th>
                  <th>Entry</th>
                  <th className="numeric">Shares / ratio</th>
                  <th className="numeric">Price · quote unit</th>
                  <th className="numeric">FX · EUR per unit</th>
                  <th className="numeric">Fee / dividend · EUR</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().map((t) => (
                  <tr key={t.sequence}>
                    <td>{dateLabel(t.date)}</td>
                    <td>{t.id}</td>
                    <td>
                      <Tag>{t.type}</Tag>
                    </td>
                    <td className="numeric">
                      {t.type === "split"
                        ? `${num(t.ratio, 4)}:1`
                        : num(t.shares)}
                    </td>
                    <td className="numeric">
                      {["buy", "sell"].includes(t.type) ? num(t.price, 3) : "—"}
                    </td>
                    <td className="numeric">
                      {["buy", "sell"].includes(t.type) ? num(t.fx, 6) : "—"}
                    </td>
                    <td className="numeric">
                      {num(t.type === "dividend" ? t.amount : t.fee, 2)}
                    </td>
                    <td className="small">{t.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="chart-footnote">
            Buys are limited to {MAX_WEIGHT}% of the portfolio at cost. Record
            net distributions and splits manually. Nothing is sent to the
            challenge account.
          </p>
        </>
      )}
      <Modal
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        title="Record an execution"
        description="Copy the fill from the challenge account."
      >
        <form onSubmit={submit} className="trade-form">
          <label>
            Eligible stock
            <select
              aria-label="Eligible stock"
              value={form.id}
              onChange={(e) => {
                const s = stocks.find((s) => s.id === e.target.value);
                setForm({
                  ...form,
                  id: s.id,
                  fx: s.currency === "EUR" ? "1" : "",
                  price: "",
                  listingChecked: false,
                });
                setError("");
              }}
            >
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.id}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Entry type
              <select
                aria-label="Entry type"
                value={form.type}
                onChange={(e) => formUpdate("type", e.target.value)}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Net distribution</option>
                <option value="split">Stock split</option>
              </select>
            </label>
            <label>
              Execution date
              <input
                type="date"
                min={START}
                max={day() < END ? day() : END}
                value={form.date}
                onChange={(e) => formUpdate("date", e.target.value)}
                required
              />
            </label>
            {["buy", "sell"].includes(form.type) ? (
              <>
                <label>
                  Number of shares
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    value={form.shares}
                    onChange={(e) => formUpdate("shares", e.target.value)}
                  />
                </label>
                <label>
                  Execution price · {stock?.quoteCurrency}
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    required
                    value={form.price}
                    onChange={(e) => formUpdate("price", e.target.value)}
                  />
                </label>
                <label>
                  EUR per 1 {stock?.currency}
                  <input
                    type="number"
                    step="any"
                    min="0.000001"
                    required
                    value={stock?.currency === "EUR" ? "1" : form.fx}
                    disabled={stock?.currency === "EUR"}
                    onChange={(e) => formUpdate("fx", e.target.value)}
                  />
                </label>
                <label>
                  Fee · EUR
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.fee}
                    onChange={(e) => formUpdate("fee", e.target.value)}
                  />
                </label>
              </>
            ) : form.type === "dividend" ? (
              <label>
                Net cash received · EUR
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  required
                  onChange={(e) => formUpdate("amount", e.target.value)}
                />
              </label>
            ) : (
              <label>
                New shares per old share
                <input
                  type="number"
                  step="any"
                  min="0.000001"
                  value={form.ratio}
                  required
                  onChange={(e) => formUpdate("ratio", e.target.value)}
                />
                <span className="small muted">
                  For a 2-for-1 split, enter 2. For a 1-for-10 consolidation,
                  enter 0.1.
                </span>
              </label>
            )}
          </div>
          {stock?.quoteScale === 0.01 && (
            <div className="inline-note">
              Enter the price in pence (GBp); enter FX in EUR per £1.
            </div>
          )}
          {stock?.flags.includes("share-class") && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.listingChecked}
                onChange={(e) => formUpdate("listingChecked", e.target.checked)}
              />{" "}
              I checked this exact share class in the challenge account.
            </label>
          )}
          <label>
            Execution note
            <input
              value={form.note}
              onChange={(e) => formUpdate("note", e.target.value)}
              placeholder="Optional reason or challenge reference"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary">
            Save journal entry <Icon name="check" size={16} />
          </Button>
        </form>
      </Modal>
      <AlertDialog.Root open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="modal-backdrop" />
          <AlertDialog.Popup className="modal confirm-modal">
            <AlertDialog.Title className="modal-title">
              Undo the latest journal entry?
            </AlertDialog.Title>
            <AlertDialog.Description>
              The latest entry is removed. Enter the corrected execution
              afterwards.
            </AlertDialog.Description>
            <div className="button-row">
              <AlertDialog.Close className="button button-secondary">
                Keep entry
              </AlertDialog.Close>
              <Button
                variant="primary"
                onClick={() => {
                  setTrades(trades.slice(0, -1));
                  setRemoveOpen(false);
                }}
              >
                Undo entry
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
