// RFC 4180 parser: quoted delimiters, escaped quotes, CRLF and multiline fields.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed quote in CSV");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length)
    throw new Error("Invalid CSV headers");
  return rows.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2}: expected ${headers.length} fields, got ${values.length}`,
      );
    return Object.fromEntries(headers.map((key, j) => [key, values[j]]));
  });
}

export function toCsv(rows, columns = Object.keys(rows[0] ?? {})) {
  const escape = (v) => {
    let text = v == null ? "" : String(v);
    // Prevent spreadsheet formula execution when exporting user-authored notes.
    if (
      /^[=+@\t\r]/.test(text) ||
      (/^-/.test(text) && !Number.isFinite(Number(text)))
    )
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    [columns, ...rows.map((r) => columns.map((k) => r[k]))]
      .map((r) => r.map(escape).join(","))
      .join("\r\n") + "\r\n"
  );
}
