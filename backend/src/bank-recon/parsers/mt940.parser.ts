/** Minimal MT940 parser — extracts :61: transaction lines.
 *  MT940 is used by many Kenyan banks (KCB, Equity, NCBA).
 *  TODO(prod): use a battle-tested library (e.g. mt940js) for full spec compliance.
 */
export interface ParsedLine {
  reference?: string;
  amount: number;
  currency: string;
  valueDate: Date;
  description: string;
}

const CREDIT_DEBIT_RE = /^:61:(\d{6})(\d{4})?([CD])(\d+,\d{2})([A-Z]{4})(.*)$/;

export function parseMt940(content: string, defaultCurrency = 'KES'): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const rawLines = content.split('\n');
  let pending: Partial<ParsedLine> | null = null;

  for (const raw of rawLines) {
    const line = raw.trimEnd();
    const m = line.match(CREDIT_DEBIT_RE);
    if (m) {
      pending = {
        valueDate: parseDate6(m[1]),
        amount: parseFloat(m[4].replace(',', '.')),
        currency: defaultCurrency,
        reference: m[5],
        description: m[6].trim(),
      };
      lines.push(pending as ParsedLine);
      pending = null;
    } else if (line.startsWith(':86:') && lines.length > 0) {
      // Narrative following the last :61: transaction
      lines[lines.length - 1].description = line.slice(4).trim();
    }
  }
  return lines;
}

function parseDate6(s: string): Date {
  const y = parseInt('20' + s.slice(0, 2), 10);
  const m = parseInt(s.slice(2, 4), 10) - 1;
  const d = parseInt(s.slice(4, 6), 10);
  return new Date(y, m, d);
}
