import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import Performance from "./Performance.jsx";
import Screener from "./Screener.jsx";
import Portfolio from "./Portfolio.jsx";
import Research from "./Research.jsx";
import {
  Button,
  Icon,
  Modal,
  Change,
  compact,
  num,
  dateLabel,
  download,
} from "./ui.jsx";
import {
  day,
  START,
  END,
  MAX_POSITIONS,
  validateTrade,
  isNum,
  historyFile,
} from "../shared/finance.mjs";

const KEY = "challenge-desk-2026-v1";
const GITHUB_KEY = "challenge-desk-2026-github";
const BASE = import.meta.env.BASE_URL || "/";
const REPO = import.meta.env.VITE_GITHUB_REPOSITORY || "";
const blank = () => ({
  version: 1,
  watchlist: [],
  draft: [],
  trades: [],
  notes: {},
});
const noMarket = {
  quotes: {},
  fx: { rates: { EUR: 1 }, date: null },
  status: "snapshot",
  errors: [],
};
function validateWorkspace(data, stocks) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.watchlist) ||
    !Array.isArray(data.draft) ||
    !Array.isArray(data.trades) ||
    typeof data.notes !== "object" ||
    !data.notes
  )
    throw new Error("This is not a valid backup file.");
  const eligible = new Set(stocks.map((s) => s.id));
  if (
    data.draft.length > MAX_POSITIONS ||
    new Set(data.draft.map((p) => p.id)).size !== data.draft.length ||
    data.draft.some(
      (p) =>
        !eligible.has(p.id) ||
        !isNum(p.weight) ||
        (p.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.added)),
    )
  )
    throw new Error("The plan contains invalid allocations or ineligible stocks.");
  // Plans saved before add dates existed count as added today.
  const draft = data.draft.map((p) => ({ ...p, added: p.added || day() }));
  if (data.watchlist.some((id) => !eligible.has(id)))
    throw new Error("The watchlist contains a listing outside this universe.");
  const checked = [];
  for (const t of data.trades) {
    if (
      !Number.isSafeInteger(t.sequence) ||
      t.sequence < 1 ||
      checked.some((x) => x.sequence >= t.sequence)
    )
      throw new Error("Invalid journal sequence.");
    const error = validateTrade(t, checked, stocks);
    if (error) throw new Error(error);
    checked.push(t);
  }
  for (const [id, note] of Object.entries(data.notes)) {
    if (
      !eligible.has(id) ||
      !note ||
      typeof note !== "object" ||
      Object.values(note).some((v) => typeof v !== "string")
    )
      throw new Error("Invalid research notes.");
  }
  const { snapshots, ...rest } = data;
  return { ...rest, draft };
}
const readGithub = () => {
  try {
    return JSON.parse(localStorage.getItem(GITHUB_KEY)) || {};
  } catch {
    return {};
  }
};

export default function App() {
  const [universe, setUniverse] = useState(null),
    [market, setMarket] = useState(noMarket),
    [histories, setHistories] = useState({}),
    [mode, setMode] = useState("unknown"),
    [job, setJob] = useState(null),
    [pending, setPending] = useState(null),
    [view, setView] = useState("performance"),
    [filters, setFilters] = useState({}),
    [stock, setStock] = useState(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [storageError, setStorageError] = useState(""),
    [toast, setToast] = useState(""),
    [workspace, setWorkspace] = useState(blank),
    [ready, setReady] = useState(false),
    [compare, setCompare] = useState([]),
    [compareOpen, setCompareOpen] = useState(false),
    [restoreData, setRestoreData] = useState(null),
    [githubOpen, setGithubOpen] = useState(false),
    [github, setGithub] = useState(() => ({ repo: REPO, ...readGithub() })),
    [githubSymbols, setGithubSymbols] = useState(null),
    [globalSearch, setGlobalSearch] = useState("");
  const inflight = useRef(new Set());
  const notify = useCallback((message) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const readMarket = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}data/market/index.json`, {
        cache: "no-cache",
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!data.quotes) throw new Error();
      setMarket((previous) =>
        previous.lastAttempt === data.lastAttempt &&
        previous.lastSuccess === data.lastSuccess &&
        previous.status === data.status
          ? previous
          : data,
      );
      return data;
    } catch {
      setError("Market data could not be loaded.");
      return null;
    }
  }, []);
  // Histories are fetched per listing when a page needs them and dropped after a refresh.
  const loadHistory = useCallback(
    async (ids) => {
      const wanted = ids.filter(
        (id) => !(id in histories) && !inflight.current.has(id),
      );
      if (!wanted.length) return;
      wanted.forEach((id) => inflight.current.add(id));
      const results = await Promise.all(
        wanted.map(async (id) => {
          try {
            const r = await fetch(
              `${BASE}data/market/history/${historyFile(id)}`,
              { cache: "no-cache" },
            );
            return [id, r.ok ? (await r.json()).history || [] : []];
          } catch {
            return [id, []];
          } finally {
            inflight.current.delete(id);
          }
        }),
      );
      setHistories((h) => ({ ...h, ...Object.fromEntries(results) }));
    },
    [histories],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BASE}data/universe.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Universe unavailable");
        return r.json();
      })
      .then((u) => {
        setUniverse(u);
        try {
          const stored = localStorage.getItem(KEY);
          if (stored)
            setWorkspace(validateWorkspace(JSON.parse(stored), u.stocks));
        } catch (e) {
          setStorageError(
            `Saved work could not be loaded: ${e.message} The stored copy has been kept.`,
          );
        }
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setLoadError("The stock universe could not be loaded.");
      });
    void readMarket();
    fetch("api/status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        setMode(s?.mode === "server" ? "server" : "static");
        if (s?.job) setJob(s.job);
      })
      .catch(() => setMode("static"));
    return () => controller.abort();
  }, [readMarket]);
  // Server mode: follow the refresh job. Static mode: look for a newer nightly file.
  useEffect(() => {
    if (mode === "unknown") return;
    let last = job?.running;
    const tick = async () => {
      if (mode === "server") {
        try {
          const s = await (await fetch("api/status")).json();
          setJob(s.job);
          if (last && !s.job?.running) {
            await readMarket();
            setHistories({});
            if (s.job?.error) setError(`Refresh failed: ${s.job.error}`);
          }
          last = s.job?.running;
        } catch {
          /* keep the last known state */
        }
      } else {
        const data = await readMarket();
        if (pending && data?.lastAttempt && data.lastAttempt > pending) {
          setPending(null);
          setHistories({});
          notify("Prices updated by the GitHub workflow.");
        }
      }
    };
    const interval =
      mode === "server" ? (job?.running ? 3000 : 20000) : pending ? 30000 : 300000;
    const t = setInterval(tick, interval);
    return () => clearInterval(t);
  }, [mode, job?.running, pending, readMarket, notify]);
  useEffect(() => {
    if (!ready || storageError) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(workspace));
    } catch {
      setStorageError(
        "Browser storage is unavailable or full. Download a backup before closing this page.",
      );
    }
  }, [workspace, ready, storageError]);
  const stocks = universe?.stocks || [];
  function navigate(next, filter = {}) {
    setView(next);
    if (next === "screener") setFilters(filter);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function refresh(symbols = null) {
    setError("");
    if (mode === "server") {
      try {
        const r = await fetch("api/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setJob({
          running: true,
          completed: 0,
          total: symbols ? symbols.length : stocks.length,
          scope: symbols ? "portfolio" : "all",
          stage: "Connecting",
        });
      } catch (e) {
        setError(e.message || "Market refresh failed.");
      }
      return;
    }
    if (!github.token || !github.repo) {
      setGithubSymbols(symbols);
      setGithubOpen(true);
      return;
    }
    await dispatch(symbols, github);
  }
  async function dispatch(symbols, settings) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${settings.repo}/actions/workflows/pages.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${settings.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            ref: settings.branch || "main",
            inputs: { symbols: symbols ? symbols.join(",") : "" },
          }),
        },
      );
      if (r.status !== 204) {
        const data = await r.json().catch(() => ({}));
        throw new Error(
          data.message ||
            `GitHub returned HTTP ${r.status}. Check the repository name and token permissions.`,
        );
      }
      setPending(new Date().toISOString());
      notify(
        `Workflow started for ${symbols ? `${symbols.length} listings` : "all listings"}. New prices appear here when it finishes.`,
      );
    } catch (e) {
      setError(e.message);
    }
  }
  function saveGithub(next) {
    setGithub(next);
    try {
      if (next.remember)
        localStorage.setItem(
          GITHUB_KEY,
          JSON.stringify({ repo: next.repo, token: next.token, branch: next.branch, remember: true }),
        );
      else localStorage.removeItem(GITHUB_KEY);
    } catch {
      /* storage unavailable: settings live for this page load only */
    }
  }
  function addDraft(id) {
    if (workspace.draft.some((p) => p.id === id)) return;
    if (workspace.draft.length >= MAX_POSITIONS) {
      notify(`The plan already holds ${MAX_POSITIONS} stocks.`);
      return;
    }
    setWorkspace((w) => ({
      ...w,
      draft: [...w.draft, { id, weight: 0, added: day() }],
    }));
    notify(`${id} added to the plan at 0%.`);
  }
  function toggleWatch(id) {
    setWorkspace((w) => ({
      ...w,
      watchlist: w.watchlist.includes(id)
        ? w.watchlist.filter((x) => x !== id)
        : [...w.watchlist, id],
    }));
  }
  function addCompare(id) {
    if (compare.includes(id)) {
      notify("Already in the comparison.");
      return;
    }
    if (compare.length >= 4) {
      notify("Compare up to four stocks at a time.");
      return;
    }
    setCompare([...compare, id]);
  }
  async function restore(file) {
    try {
      if (file.size > 5000000) throw new Error("Backup is too large.");
      const data = validateWorkspace(JSON.parse(await file.text()), stocks);
      setRestoreData(data);
    } catch (e) {
      notify(`Cannot restore: ${e.message}`);
    }
  }
  const backup = () =>
    download(
      `challenge-desk-backup-${day()}.json`,
      JSON.stringify(workspace, null, 2),
      "application/json",
    );
  if (loadError)
    return (
      <main className="boot-error">
        <Icon name="alert" size={30} />
        <h1>The stock universe could not be loaded.</h1>
        <p>{loadError}</p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </main>
    );
  if (!universe)
    return (
      <main className="boot-loading" aria-busy="true">
        <span className="brand-mark">T</span>
        <h1>Loading…</h1>
        <div className="loading-line" />
      </main>
    );
  const titles = [
    ["performance", "Performance"],
    ["screener", "Screener"],
    ["portfolio", "Portfolio"],
  ];
  const available = Object.keys(market.quotes || {}).length;
  const priceDate = Object.values(market.quotes || {})
    .map((q) => q.priceDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const mine = [
    ...new Set([
      ...workspace.draft.map((p) => p.id),
      ...workspace.trades.map((t) => t.id),
    ]),
  ];
  const busy = !!job?.running || !!pending;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header>
        <div className="utility-bar">
          <div>
            <span className="utility-label">TRENDS INVESTMENT CHALLENGE</span>
            <span className="utility-divider">/</span>
            <span>5 OCT – 27 NOV 2026</span>
          </div>
          <span>
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/Brussels",
            })}
          </span>
        </div>
        <div className="masthead">
          <button
            className="brand"
            onClick={() => navigate("performance")}
            aria-label="Home"
          >
            <span className="brand-mark">
              T<span>.</span>
            </span>
            <div>
              <span className="brand-title">THE CHALLENGE</span>
              <span className="brand-subtitle">RESEARCH DESK · 2026</span>
            </div>
          </button>
          <div className="masthead-right">
            <span className="edition-label">
              €100,000 · 5–20 STOCKS
              <br />
              MAX 25% PER POSITION
            </span>
            <span className="edition-square">26</span>
          </div>
        </div>
        <div className="nav-row">
          <nav aria-label="Main navigation">
            {titles.map(([id, label]) => (
              <button
                key={id}
                aria-current={view === id ? "page" : undefined}
                className={view === id ? "active" : ""}
                onClick={() => navigate(id)}
              >
                {label}
                {id === "portfolio" && workspace.draft.length > 0 && (
                  <span className="nav-count">{workspace.draft.length}</span>
                )}
              </button>
            ))}
          </nav>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("screener", { query: globalSearch });
            }}
          >
            <Icon name="search" size={15} />
            <input
              aria-label="Find a stock"
              placeholder="Find a stock"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            <button
              type="submit"
              className="icon-button"
              aria-label="Search universe"
            >
              <Icon name="arrow" size={14} />
            </button>
          </form>
        </div>
        <div className="data-ribbon">
          <span>
            <span className={`status-dot ${available ? "" : "amber"}`} />
            {job?.running
              ? `${job.stage} · ${job.completed}/${job.total}`
              : pending
                ? "GitHub workflow running · waiting for new prices"
                : available
                  ? `Prices as of ${dateLabel(priceDate, true)} · FX ${dateLabel(market.fx?.date)}`
                  : "No price data yet"}
            <span className="ribbon-extra">
              {mode === "static"
                ? "Updated nightly by GitHub Actions"
                : mode === "server"
                  ? "Local server · nightly refresh after 22:15 UTC"
                  : ""}
            </span>
          </span>
          <span className="ribbon-actions">
            {mine.length > 0 && (
              <button onClick={() => refresh(mine)} disabled={busy}>
                <Icon name="refresh" size={13} />
                Refresh my {mine.length} stocks
              </button>
            )}
            <button onClick={() => refresh(null)} disabled={busy}>
              <Icon name="refresh" size={13} />
              Refresh all
            </button>
            {mode === "static" && (
              <button
                onClick={() => {
                  setGithubSymbols(null);
                  setGithubOpen(true);
                }}
                aria-label="GitHub settings"
                title="GitHub settings"
              >
                <Icon name="filter" size={13} />
              </button>
            )}
          </span>
        </div>
        {error && (
          <div className="connection-message" role="status">
            <Icon name="info" size={14} />
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {storageError && (
          <div className="connection-message warning" role="alert">
            {storageError}
            <button onClick={backup}>Download backup</button>
          </div>
        )}
      </header>
      <main id="main-content" className="main-content">
        {view === "performance" && (
          <Performance
            stocks={stocks}
            market={market}
            histories={histories}
            loadHistory={loadHistory}
            draft={workspace.draft}
            trades={workspace.trades}
            navigate={navigate}
            openStock={setStock}
            refresh={() => refresh(mine)}
            busy={busy}
          />
        )}
        {view === "screener" && (
          <Screener
            stocks={stocks}
            market={market}
            watchlist={workspace.watchlist}
            toggleWatch={toggleWatch}
            draft={workspace.draft}
            addDraft={addDraft}
            openStock={setStock}
            filters={filters}
            setFilters={setFilters}
          />
        )}
        {view === "portfolio" && (
          <Portfolio
            stocks={stocks}
            market={market}
            draft={workspace.draft}
            setDraft={(draft) => setWorkspace((w) => ({ ...w, draft }))}
            trades={workspace.trades}
            setTrades={(trades) => setWorkspace((w) => ({ ...w, trades }))}
            notes={workspace.notes}
            navigate={navigate}
            openStock={setStock}
            notify={notify}
            backup={backup}
            restore={restore}
          />
        )}
      </main>
      <footer>
        <div className="footer-brand">
          THE CHALLENGE<span>Trends Investment Challenge 2026</span>
        </div>
        <p>
          Prices: Yahoo Finance (unofficial, may be delayed). FX: ECB reference
          rates via Frankfurter. Plans and journal are stored in this browser only.
        </p>
        <span>05 OCT — 27 NOV 2026</span>
      </footer>
      {stock && (
        <Research
          stock={stock}
          market={market}
          histories={histories}
          loadHistory={loadHistory}
          close={() => setStock(null)}
          watchlist={workspace.watchlist}
          toggleWatch={toggleWatch}
          draft={workspace.draft}
          addDraft={addDraft}
          notes={workspace.notes}
          saveNote={(id, note) =>
            setWorkspace((w) => ({ ...w, notes: { ...w.notes, [id]: note } }))
          }
          addCompare={addCompare}
        />
      )}
      {compare.length > 0 && (
        <div className="compare-dock">
          <span>{compare.join(" · ")}</span>
          <Button
            variant="primary"
            onClick={() => {
              setStock(null);
              setCompareOpen(true);
            }}
          >
            Compare {compare.length} stocks <Icon name="arrow" size={14} />
          </Button>
          <button
            className="icon-button"
            aria-label="Clear comparison"
            onClick={() => setCompare([])}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Side by side"
        description="Market caps keep their source currency."
        wide
      >
        <div className="table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                {compare.map((id) => (
                  <th key={id}>
                    {stocks.find((s) => s.id === id)?.name}
                    <small>{id}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Sector", (s) => s.sector],
                ["Quote currency", (s) => s.quoteCurrency],
                [
                  "Market cap",
                  (s, q) =>
                    `${compact(q?.marketCap ?? s.marketCap)} ${q?.marketCapCurrency || s.marketCapCurrency}`,
                ],
                ["Price", (s, q) => num(q?.price, 2)],
                ["Price date", (s, q) => dateLabel(q?.asOf)],
                ["21-session return", (s, q) => <Change value={q?.return21} />],
                ["63-session return", (s, q) => <Change value={q?.return63} />],
                [
                  "Annualized volatility",
                  (s, q) =>
                    isNum(q?.volatility) ? `${num(q.volatility, 1)}%` : "—",
                ],
                ["Trailing P/E", (s, q) => num(q?.pe, 1)],
                ["Next earnings", (s, q) => dateLabel(q?.earningsDate)],
                [
                  "Listing status",
                  (s) =>
                    s.flags.includes("share-class")
                      ? "Share class unconfirmed"
                      : "Matched",
                ],
                ["Thesis", (s) => workspace.notes[s.id]?.thesis || "—"],
              ].map(([label, get]) => (
                <tr key={label}>
                  <th>{label}</th>
                  {compare.map((id) => {
                    const s = stocks.find((s) => s.id === id);
                    return <td key={id}>{get(s, market.quotes?.[id])}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
      <Modal
        open={githubOpen}
        onClose={() => setGithubOpen(false)}
        title="Refresh prices through GitHub"
        description="This page is static. A refresh starts the repository's Pages workflow, which fetches new prices, commits them and redeploys the site. A fine-grained token with Actions: read and write on the repository is required."
      >
        <form
          className="trade-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const next = {
              repo: String(form.get("repo")).trim(),
              token: String(form.get("token")).trim(),
              branch: String(form.get("branch")).trim() || "main",
              remember: form.get("remember") === "on",
            };
            saveGithub(next);
            setGithubOpen(false);
            if (next.repo && next.token) await dispatch(githubSymbols, next);
          }}
        >
          <div className="form-grid">
            <label>
              Repository (owner/name)
              <input name="repo" defaultValue={github.repo || ""} required />
            </label>
            <label>
              Branch
              <input name="branch" defaultValue={github.branch || "main"} />
            </label>
          </div>
          <label>
            Fine-grained personal access token
            <input
              name="token"
              type="password"
              defaultValue={github.token || ""}
              autoComplete="off"
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="remember"
              defaultChecked={github.remember !== false}
            />{" "}
            Remember the token in this browser
          </label>
          <div className="button-row">
            {github.token && (
              <Button
                type="button"
                onClick={() => {
                  saveGithub({ repo: github.repo, remember: false });
                  setGithubOpen(false);
                }}
              >
                Forget token
              </Button>
            )}
            <Button type="submit" variant="primary">
              {githubSymbols === null ? "Save and refresh all" : "Save and refresh"}
            </Button>
          </div>
        </form>
      </Modal>
      <AlertDialog.Root
        open={!!restoreData}
        onOpenChange={(v) => !v && setRestoreData(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="modal-backdrop" />
          <AlertDialog.Popup className="modal confirm-modal">
            <AlertDialog.Title className="modal-title">
              Restore this backup?
            </AlertDialog.Title>
            <AlertDialog.Description>
              {restoreData?.draft.length} planned positions,{" "}
              {restoreData?.watchlist.length} watched stocks and{" "}
              {restoreData?.trades.length} journal entries will replace what is
              stored in this browser.
            </AlertDialog.Description>
            <div className="button-row">
              <AlertDialog.Close className="button button-secondary">
                Cancel
              </AlertDialog.Close>
              <Button
                variant="primary"
                onClick={() => {
                  setWorkspace(restoreData);
                  setStorageError("");
                  setRestoreData(null);
                  notify("Backup restored.");
                }}
              >
                Restore
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </>
  );
}
