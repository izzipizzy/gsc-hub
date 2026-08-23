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

export function rowsToCsv<T>(
  header: string[],
  rows: T[],
  mapper: (row: T) => string[]
): string {
  const lines: string[] = [header.map(escape).join(',')];
  for (const row of rows) {
    lines.push(mapper(row).map(neutralizeFormula).map(escape).join(','));
  }
  return lines.join('\n') + '\n';
}
