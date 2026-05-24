/** camt.053 XML parser (ISO 20022 bank-to-customer statement).
 *  TODO(prod): use fast-xml-parser or xml2js with full schema validation.
 */
import { ParsedLine } from './mt940.parser';

export function parseCamt053(xml: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  // Minimal regex extraction — replace with proper XML parsing in production.
  const txRe = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let match: RegExpExecArray | null;
  while ((match = txRe.exec(xml)) !== null) {
    const block = match[1];
    const amt = extractTag(block, 'Amt');
    const ccy = extractAttr(block, 'Amt', 'Ccy');
    const dt = extractTag(block, 'ValDt') || extractTag(block, 'BookgDt');
    const ref = extractTag(block, 'EndToEndId') || extractTag(block, 'Ref');
    const desc = extractTag(block, 'Ustrd') || extractTag(block, 'AddtlNtryInf') || '';
    if (!amt) continue;
    lines.push({
      amount: parseFloat(amt),
      currency: ccy || 'KES',
      valueDate: dt ? new Date(dt) : new Date(),
      reference: ref || undefined,
      description: desc,
    });
  }
  return lines;
}

function extractTag(s: string, tag: string): string {
  const m = s.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return m ? m[1].trim() : '';
}

function extractAttr(s: string, tag: string, attr: string): string {
  const m = s.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`));
  return m ? m[1] : '';
}
