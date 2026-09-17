import React from "react";
import clsx from "clsx";
import { Dialog } from "@base-ui/react/dialog";
import { isNum } from "../shared/finance.mjs";
export const cn = clsx;
export const num = (n, d = 0) =>
  isNum(n)
    ? new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(n)
    : "—";
export const eur = (n, d = 0) =>
  isNum(n)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(n)
    : "—";
export const pct = (n, d = 2) =>
  isNum(n) ? `${n > 0 ? "+" : ""}${num(n, d)}%` : "—";
export const compact = (n) =>
  !isNum(n)
    ? "—"
    : n >= 1e12
      ? `${num(n / 1e12, 2)}tn`
      : n >= 1e9
        ? `${num(n / 1e9, 1)}bn`
        : n >= 1e6
          ? `${num(n / 1e6, 1)}m`
          : num(n);
export const dateLabel = (date, year = false) =>
  date
    ? new Date(date.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        ...(year ? { year: "numeric" } : {}),
      })
    : "Not available";
export function Icon({ name, size = 18, ...props }) {
  const paths = {
    arrow: "M4 12h16m-6-6 6 6-6 6",
    up: "m7 17 10-10M7 7h10v10",
    search: "m21 21-5.2-5.2M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15",
    plus: "M12 5v14M5 12h14",
    close: "m6 6 12 12M6 18 18 6",
    refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    check: "m5 12 4 4L19 6",
    chevron: "m9 5 7 7-7 7",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
    filter: "M4 6h16M7 12h10M10 18h4",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    chart: "M4 3v17h17M7 15l4-5 4 2 6-8",
    wallet: "M20 8V5H4v15h17V8H4M16 12h5v4h-5z",
    calendar: "M4 5h16v16H4zM8 3v5M16 3v5M4 10h16",
    file: "M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6",
    alert: "m12 3 10 18H2ZM12 9v5M12 17h.01",
    minus: "M5 12h14",
    undo: "m7 4-4 4 4 4M3 8h11a6 6 0 0 1 0 12",
    external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
    sort: "m8 4-4 4h8m-4-4v16m8 0 4-4h-8m4 4V4",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.info} />
    </svg>
  );
}
export function Button({
  children,
  variant = "secondary",
  className,
  ...props
}) {
  return (
    <button className={cn("button", `button-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}
export function Tag({ children, tone = "neutral" }) {
  return <span className={cn("tag", `tag-${tone}`)}>{children}</span>;
}
export function Change({ value }) {
  return (
    <span
      className={cn(
        "change",
        isNum(value) && value > 0 && "positive",
        isNum(value) && value < 0 && "negative",
      )}
    >
      {pct(value)}
    </span>
  );
}
export function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Empty({ icon = "chart", title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className={cn("modal", wide && "modal-wide")}>
          <div className="modal-heading">
            <div>
              <Dialog.Title className="modal-title">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="muted small">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Sparkline({
  history = [],
  large = false,
  label = "Daily closing price history",
  color,
}) {
  const values = history
    .map((p) => (typeof p === "number" ? p : p.close))
    .filter(isNum);
  if (values.length < 2)
    return large ? (
      <Empty title="No price history" icon="chart">
        Daily prices appear after a successful refresh.
      </Empty>
    ) : (
      <span className="no-history">No prices</span>
    );
  const w = large ? 760 : 106,
    h = large ? 230 : 32,
    pad = large ? 14 : 3;
  const low = Math.min(...values),
    high = Math.max(...values),
    range = high - low || high * 0.02 || 1;
  const points = values.map((v, i) => [
    pad + (i * (w - 2 * pad)) / (values.length - 1),
    h - pad - ((v - low) * (h - 2 * pad)) / range,
  ]);
  const path = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const tone = color || (values.at(-1) >= values[0] ? "#14655b" : "#ab493e");
  return (
    <svg
      className={large ? "price-chart" : "sparkline"}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <title>{label}</title>
      {large &&
        [0.2, 0.5, 0.8].map((v) => (
          <line
            key={v}
            x1="0"
            x2={w}
            y1={h * v}
            y2={h * v}
            stroke="#ddd8ce"
            strokeDasharray="3 5"
          />
        ))}
      {large && (
        <path
          d={`${path} L${w - pad},${h} L${pad},${h} Z`}
          fill={tone}
          opacity=".06"
        />
      )}
      <path
        d={path}
        stroke={tone}
        strokeWidth={large ? 2.2 : 1.7}
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      {large && (
        <circle cx={points.at(-1)[0]} cy={points.at(-1)[1]} r="3" fill={tone} />
      )}
    </svg>
  );
}
export function download(name, content, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
