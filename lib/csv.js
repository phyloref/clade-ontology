/*
 * lib/csv.js: Minimal CSV output helpers shared by the scripts that emit reports.
 */

/** Escape a value for CSV output, quoting only when the field needs it. */
function escapeCSV(field) {
  const str = String(field == null ? '' : field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

module.exports = { escapeCSV };
