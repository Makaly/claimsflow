/**
 * Embedded minimal ICD-10 lookup table.
 * Keys are code prefixes; values are plain-English descriptions.
 * Extend this list as clinical coverage expands.
 */
export const ICD10_PARTIAL_LIST: Record<string, string> = {
  A00: 'Cholera',
  A01: 'Typhoid and paratyphoid fevers',
  A09: 'Diarrhoea and gastroenteritis',
  B20: 'HIV disease',
  C00: 'Malignant neoplasm of lip',
  C34: 'Malignant neoplasm of bronchus and lung',
  C50: 'Malignant neoplasm of breast',
  D50: 'Iron deficiency anaemia',
  E10: 'Type 1 diabetes mellitus',
  E11: 'Type 2 diabetes mellitus',
  F32: 'Depressive episode',
  G40: 'Epilepsy',
  I10: 'Essential hypertension',
  I21: 'Acute myocardial infarction',
  I50: 'Heart failure',
  J00: 'Acute nasopharyngitis',
  J18: 'Pneumonia',
  J45: 'Asthma',
  K21: 'Gastro-oesophageal reflux disease',
  K29: 'Gastritis',
  K80: 'Cholelithiasis',
  L20: 'Atopic dermatitis',
  M54: 'Back pain',
  N18: 'Chronic kidney disease',
  N39: 'Urinary tract infection',
  O80: 'Uncomplicated vaginal delivery',
  R05: 'Cough',
  R50: 'Fever',
  S00: 'Superficial injury of head',
  S72: 'Fracture of femur',
  Z00: 'General examination',
  Z23: 'Immunisation',
};

/**
 * Attempt to match a free-text string against known ICD-10 codes.
 * Returns matched codes with descriptions.
 */
export function extractIcd10Hints(text: string): { code: string; description: string }[] {
  const upper = text.toUpperCase();
  const results: { code: string; description: string }[] = [];
  // Match explicit codes like "I10", "E11.9", "J45.1"
  const codeRegex = /\b([A-Z]\d{2})(\.\d)?\b/g;
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(upper)) !== null) {
    const prefix = match[1];
    if (ICD10_PARTIAL_LIST[prefix]) {
      results.push({ code: prefix, description: ICD10_PARTIAL_LIST[prefix] });
    }
  }
  return results;
}
