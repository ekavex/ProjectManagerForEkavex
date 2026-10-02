/**
 * CSV writing for exports (spec section 57, "Export").
 *
 * RFC 4180 quoting, a byte-order mark so spreadsheet programs read UTF-8 correctly, and
 * CRLF line ends. Any cell that begins with a formula character is prefixed with an
 * apostrophe: an exported task name such as `=HYPERLINK(...)` must stay text, not become
 * a live formula in whoever opens the file (CSV injection).
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
