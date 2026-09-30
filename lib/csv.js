/*
 * lib/csv.js: Minimal CSV helpers shared by the scripts that emit reports and the tests that
 * read them back.
 */

/** Escape a value for CSV output, quoting only when the field needs it. */
function escapeCSV(field) {
  const str = String(field == null ? '' : field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Split one CSV line into fields, honouring the quoting that escapeCSV applies. Splitting on
 * `,` is not good enough: the labels and citation lists we write routinely contain commas
 * ("Mallatt & Winchell 2007, fig. 1"), and a naive split shifts every later column.
 *
 * Embedded newlines are not supported (nothing we write contains one).
 */
function parseCSVRow(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') { field += '"'; i += 1; } // An escaped quote ("").
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

module.exports = { escapeCSV, parseCSVRow };
