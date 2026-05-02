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
    lines.push(mapper(row).map(escape).join(','));
  }
  return lines.join('\n') + '\n';
}
