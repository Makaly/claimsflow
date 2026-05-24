import { ParsedLine } from './mt940.parser';

/** Parses a CSV bank statement.
 *  Expected columns (case-insensitive): date, reference, amount, currency, description.
 *  TODO(prod): make column mapping configurable per-bank via system-config.
 */
export function parseCsvStatement(content: string): ParsedLine[] {
  const rows = content.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const dateIdx = idx('date') >= 0 ? idx('date') : idx('valuedate');
  const amtIdx = idx('amount') >= 0 ? idx('amount') : idx('debit');
  const refIdx = idx('reference') >= 0 ? idx('reference') : idx('ref');
  const descIdx = idx('description') >= 0 ? idx('description') : idx('narration');
  const ccyIdx = idx('currency');

  return rows
    .slice(1)
    .filter(r => r.length > 1 && r[amtIdx])
    .map(r => ({
      valueDate: dateIdx >= 0 ? new Date(r[dateIdx]) : new Date(),
      amount: Math.abs(parseFloat(r[amtIdx].replace(/,/g, ''))),
      currency: ccyIdx >= 0 ? r[ccyIdx] || 'KES' : 'KES',
      reference: refIdx >= 0 ? r[refIdx] || undefined : undefined,
      description: descIdx >= 0 ? r[descIdx] || '' : '',
    }));
}
