/**
 * Embedded minimal drug mention list (generic names).
 * Stub dataset — replace with a licensed drug database in production.
 */
export const COMMON_DRUGS = [
  'metformin', 'lisinopril', 'atorvastatin', 'amlodipine', 'omeprazole',
  'amoxicillin', 'ciprofloxacin', 'metronidazole', 'doxycycline', 'azithromycin',
  'paracetamol', 'ibuprofen', 'diclofenac', 'tramadol', 'morphine',
  'salbutamol', 'prednisolone', 'dexamethasone', 'hydrocortisone',
  'furosemide', 'spironolactone', 'warfarin', 'heparin', 'aspirin',
  'insulin', 'glibenclamide', 'glimepiride',
  'cotrimoxazole', 'artemether', 'lumefantrine', 'quinine',
  'tenofovir', 'lamivudine', 'efavirenz',
];

export function extractDrugMentions(text: string): string[] {
  const lower = text.toLowerCase();
  return COMMON_DRUGS.filter((drug) => lower.includes(drug));
}
