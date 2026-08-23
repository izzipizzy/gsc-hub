// Excel and LibreOffice treat a cell starting with one of these as a formula.
// Leading whitespace, a tab or a carriage return do not stop them, so match
// those too rather than only the first character.
const FORMULA_PREFIX = /^[\s ]*[=+\-@]/;

// Search queries reach these exports verbatim, and anyone can run a Google
// search that starts with "=". Prefixing with an apostrophe makes the cell text
// again — visible in the file, stripped by the spreadsheet on display.
function neutralizeFormula(field: string): string {
  if (!FORMULA_PREFIX.test(field)) return field;
  // Numbers are the reason this is not applied blindly: clicks and position are
  // formatted through the same path, and "-0.5" is a value, not a formula.
  const trimmed = field.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return field;
  return `'${field}`;
}

function escape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// One CSV record, terminated. Exposed so a large export can be streamed row by
// row instead of assembled in memory first.
export function csvLine(fields: string[]): string {
  return fields.map(neutralizeFormula).map(escape).join(',') + '\n';
}

export function csvHeader(fields: string[]): string {
  return fields.map(escape).join(',') + '\n';
}

export function rowsToCsv<T>(
  header: string[],
  rows: T[],
  mapper: (row: T) => string[]
): string {
  let out = csvHeader(header);
  for (const row of rows) out += csvLine(mapper(row));
  return out;
}
