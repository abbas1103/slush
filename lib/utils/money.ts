/**
 * Money is integer pence everywhere. These helpers are the ONLY place we turn
 * pence into a display string, so formatting stays consistent app-wide.
 */

export interface FormatOpts {
  /** Drop a trailing `.00` - used for compact button labels ("Pay £150"). */
  stripZeros?: boolean;
  /** Group thousands ("£1,050.00") - used for large admin sums. */
  grouped?: boolean;
}

export function formatPence(pence: number, opts: FormatOpts = {}): string {
  const pounds = pence / 100;
  const body = opts.grouped
    ? pounds.toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : pounds.toFixed(2);
  const out = `£${body}`;
  return opts.stripZeros ? out.replace(/\.00$/, "") : out;
}
