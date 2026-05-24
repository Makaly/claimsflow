/**
 * Minimal HL7 v2 parser — no external dependencies.
 * Splits a raw HL7 message by MSH segment delimiters and decodes
 * ADT (patient), DFT (financial transaction), and ORM (order) message types.
 */

export interface Hl7Segment {
  name: string;
  fields: string[];
}

export interface Hl7Message {
  type: string;   // e.g. "ADT", "DFT", "ORM"
  event: string;  // e.g. "A01", "P03"
  segments: Hl7Segment[];
}

function splitEscaped(str: string, sep: string): string[] {
  return str.split(sep);
}

export function parseHl7(raw: string): Hl7Message {
  // Normalise line endings
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());

  const segments: Hl7Segment[] = lines.map((line) => {
    const fields = splitEscaped(line, '|');
    return { name: fields[0], fields };
  });

  const msh = segments.find((s) => s.name === 'MSH');
  if (!msh) throw new Error('HL7 message missing MSH segment');

  // MSH.9 = message type field, e.g. "ADT^A01"
  const typeField = msh.fields[8] ?? '';
  const [type, event] = typeField.split('^');

  return { type: type ?? 'UNKNOWN', event: event ?? '', segments };
}

export function hl7ToClaimPayload(msg: Hl7Message): Record<string, any> {
  const pid = msg.segments.find((s) => s.name === 'PID');
  const pv1 = msg.segments.find((s) => s.name === 'PV1');
  const ft1 = msg.segments.find((s) => s.name === 'FT1'); // DFT financial
  const orc = msg.segments.find((s) => s.name === 'ORC'); // ORM order

  return {
    memberNumber: pid?.fields[3] ?? null,
    memberName: pid?.fields[5]?.replace('^', ' ') ?? null,
    patientId: pid?.fields[2] ?? null,
    diagnosis: pv1?.fields[17] ?? null,
    invoiceAmount: ft1 ? parseFloat(ft1.fields[10] ?? '0') : null,
    procedureCodes: orc ? [orc.fields[4]].filter(Boolean) : [],
    structuredSource: true,
  };
}
