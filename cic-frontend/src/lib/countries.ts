// ISO-3166 country list with phone dial codes and flag emojis.
// Sourced from the public CLDR + ITU lists. Order: Kenya first (the default
// for ClaimsFlow), then East African + common neighbours, then the rest
// alphabetical — so the picker feels Kenya-local without losing global reach.

export interface Country {
  iso2: string
  name: string
  dial: string
  flag: string
}

// Helper to render a flag emoji from a 2-letter ISO code.
const flag = (iso: string) =>
  iso.toUpperCase().split('').map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('')

const RAW: Array<[string, string, string]> = [
  // [iso2, name, dial]
  ['KE', 'Kenya', '+254'],
  ['UG', 'Uganda', '+256'],
  ['TZ', 'Tanzania', '+255'],
  ['RW', 'Rwanda', '+250'],
  ['ET', 'Ethiopia', '+251'],
  ['SS', 'South Sudan', '+211'],
  ['SO', 'Somalia', '+252'],
  ['BI', 'Burundi', '+257'],
  ['DJ', 'Djibouti', '+253'],
  ['ER', 'Eritrea', '+291'],
  // Rest of Africa
  ['DZ', 'Algeria', '+213'], ['AO', 'Angola', '+244'], ['BJ', 'Benin', '+229'],
  ['BW', 'Botswana', '+267'], ['BF', 'Burkina Faso', '+226'], ['CM', 'Cameroon', '+237'],
  ['CV', 'Cape Verde', '+238'], ['CF', 'Central African Republic', '+236'],
  ['TD', 'Chad', '+235'], ['KM', 'Comoros', '+269'], ['CG', 'Congo', '+242'],
  ['CD', 'Congo (DRC)', '+243'], ['CI', 'Côte d’Ivoire', '+225'], ['EG', 'Egypt', '+20'],
  ['GQ', 'Equatorial Guinea', '+240'], ['GA', 'Gabon', '+241'], ['GM', 'Gambia', '+220'],
  ['GH', 'Ghana', '+233'], ['GN', 'Guinea', '+224'], ['GW', 'Guinea-Bissau', '+245'],
  ['LS', 'Lesotho', '+266'], ['LR', 'Liberia', '+231'], ['LY', 'Libya', '+218'],
  ['MG', 'Madagascar', '+261'], ['MW', 'Malawi', '+265'], ['ML', 'Mali', '+223'],
  ['MR', 'Mauritania', '+222'], ['MU', 'Mauritius', '+230'], ['MA', 'Morocco', '+212'],
  ['MZ', 'Mozambique', '+258'], ['NA', 'Namibia', '+264'], ['NE', 'Niger', '+227'],
  ['NG', 'Nigeria', '+234'], ['ST', 'São Tomé and Príncipe', '+239'],
  ['SN', 'Senegal', '+221'], ['SC', 'Seychelles', '+248'], ['SL', 'Sierra Leone', '+232'],
  ['ZA', 'South Africa', '+27'], ['SD', 'Sudan', '+249'], ['SZ', 'Eswatini', '+268'],
  ['TG', 'Togo', '+228'], ['TN', 'Tunisia', '+216'], ['ZM', 'Zambia', '+260'],
  ['ZW', 'Zimbabwe', '+263'],
  // Americas
  ['US', 'United States', '+1'], ['CA', 'Canada', '+1'], ['MX', 'Mexico', '+52'],
  ['AR', 'Argentina', '+54'], ['BO', 'Bolivia', '+591'], ['BR', 'Brazil', '+55'],
  ['CL', 'Chile', '+56'], ['CO', 'Colombia', '+57'], ['CR', 'Costa Rica', '+506'],
  ['CU', 'Cuba', '+53'], ['DO', 'Dominican Republic', '+1'], ['EC', 'Ecuador', '+593'],
  ['SV', 'El Salvador', '+503'], ['GT', 'Guatemala', '+502'], ['HT', 'Haiti', '+509'],
  ['HN', 'Honduras', '+504'], ['JM', 'Jamaica', '+1'], ['NI', 'Nicaragua', '+505'],
  ['PA', 'Panama', '+507'], ['PY', 'Paraguay', '+595'], ['PE', 'Peru', '+51'],
  ['TT', 'Trinidad and Tobago', '+1'], ['UY', 'Uruguay', '+598'], ['VE', 'Venezuela', '+58'],
  ['BS', 'Bahamas', '+1'], ['BB', 'Barbados', '+1'], ['BZ', 'Belize', '+501'],
  ['GY', 'Guyana', '+592'], ['SR', 'Suriname', '+597'],
  // Europe
  ['AL', 'Albania', '+355'], ['AD', 'Andorra', '+376'], ['AT', 'Austria', '+43'],
  ['BY', 'Belarus', '+375'], ['BE', 'Belgium', '+32'], ['BA', 'Bosnia and Herzegovina', '+387'],
  ['BG', 'Bulgaria', '+359'], ['HR', 'Croatia', '+385'], ['CY', 'Cyprus', '+357'],
  ['CZ', 'Czechia', '+420'], ['DK', 'Denmark', '+45'], ['EE', 'Estonia', '+372'],
  ['FI', 'Finland', '+358'], ['FR', 'France', '+33'], ['DE', 'Germany', '+49'],
  ['GR', 'Greece', '+30'], ['HU', 'Hungary', '+36'], ['IS', 'Iceland', '+354'],
  ['IE', 'Ireland', '+353'], ['IT', 'Italy', '+39'], ['XK', 'Kosovo', '+383'],
  ['LV', 'Latvia', '+371'], ['LI', 'Liechtenstein', '+423'], ['LT', 'Lithuania', '+370'],
  ['LU', 'Luxembourg', '+352'], ['MT', 'Malta', '+356'], ['MD', 'Moldova', '+373'],
  ['MC', 'Monaco', '+377'], ['ME', 'Montenegro', '+382'], ['NL', 'Netherlands', '+31'],
  ['MK', 'North Macedonia', '+389'], ['NO', 'Norway', '+47'], ['PL', 'Poland', '+48'],
  ['PT', 'Portugal', '+351'], ['RO', 'Romania', '+40'], ['RU', 'Russia', '+7'],
  ['SM', 'San Marino', '+378'], ['RS', 'Serbia', '+381'], ['SK', 'Slovakia', '+421'],
  ['SI', 'Slovenia', '+386'], ['ES', 'Spain', '+34'], ['SE', 'Sweden', '+46'],
  ['CH', 'Switzerland', '+41'], ['UA', 'Ukraine', '+380'], ['GB', 'United Kingdom', '+44'],
  ['VA', 'Vatican City', '+39'],
  // Middle East
  ['AF', 'Afghanistan', '+93'], ['BH', 'Bahrain', '+973'], ['IR', 'Iran', '+98'],
  ['IQ', 'Iraq', '+964'], ['IL', 'Israel', '+972'], ['JO', 'Jordan', '+962'],
  ['KW', 'Kuwait', '+965'], ['LB', 'Lebanon', '+961'], ['OM', 'Oman', '+968'],
  ['PS', 'Palestine', '+970'], ['QA', 'Qatar', '+974'], ['SA', 'Saudi Arabia', '+966'],
  ['SY', 'Syria', '+963'], ['TR', 'Türkiye', '+90'], ['AE', 'United Arab Emirates', '+971'],
  ['YE', 'Yemen', '+967'],
  // Asia
  ['AM', 'Armenia', '+374'], ['AZ', 'Azerbaijan', '+994'], ['BD', 'Bangladesh', '+880'],
  ['BT', 'Bhutan', '+975'], ['BN', 'Brunei', '+673'], ['KH', 'Cambodia', '+855'],
  ['CN', 'China', '+86'], ['GE', 'Georgia', '+995'], ['HK', 'Hong Kong', '+852'],
  ['IN', 'India', '+91'], ['ID', 'Indonesia', '+62'], ['JP', 'Japan', '+81'],
  ['KZ', 'Kazakhstan', '+7'], ['KG', 'Kyrgyzstan', '+996'], ['LA', 'Laos', '+856'],
  ['MO', 'Macao', '+853'], ['MY', 'Malaysia', '+60'], ['MV', 'Maldives', '+960'],
  ['MN', 'Mongolia', '+976'], ['MM', 'Myanmar', '+95'], ['NP', 'Nepal', '+977'],
  ['KP', 'North Korea', '+850'], ['PK', 'Pakistan', '+92'], ['PH', 'Philippines', '+63'],
  ['SG', 'Singapore', '+65'], ['KR', 'South Korea', '+82'], ['LK', 'Sri Lanka', '+94'],
  ['TW', 'Taiwan', '+886'], ['TJ', 'Tajikistan', '+992'], ['TH', 'Thailand', '+66'],
  ['TM', 'Turkmenistan', '+993'], ['UZ', 'Uzbekistan', '+998'], ['VN', 'Vietnam', '+84'],
  // Oceania
  ['AU', 'Australia', '+61'], ['FJ', 'Fiji', '+679'], ['KI', 'Kiribati', '+686'],
  ['MH', 'Marshall Islands', '+692'], ['FM', 'Micronesia', '+691'], ['NR', 'Nauru', '+674'],
  ['NZ', 'New Zealand', '+64'], ['PW', 'Palau', '+680'], ['PG', 'Papua New Guinea', '+675'],
  ['WS', 'Samoa', '+685'], ['SB', 'Solomon Islands', '+677'], ['TO', 'Tonga', '+676'],
  ['TV', 'Tuvalu', '+688'], ['VU', 'Vanuatu', '+678'],
]

export const COUNTRIES: Country[] = RAW.map(([iso2, name, dial]) => ({
  iso2, name, dial, flag: flag(iso2),
}))

export const COUNTRY_BY_ISO: Record<string, Country> = Object.fromEntries(
  COUNTRIES.map((c) => [c.iso2, c]),
)

export const DEFAULT_COUNTRY_ISO = 'KE'

/** Parse a phone string with leading +<dial> into { iso2, local }, or return
 *  the input unchanged if no dial code matches. */
export function splitPhone(phone: string | undefined | null): { iso2: string; local: string } {
  if (!phone) return { iso2: DEFAULT_COUNTRY_ISO, local: '' }
  const trimmed = phone.trim()
  // Match the longest dial code that prefixes the input so '+1' (US) doesn't
  // steal '+1xx' (Bahamas etc.) — but for ClaimsFlow the order rarely matters.
  const candidates = COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length)
  for (const c of candidates) {
    if (trimmed.startsWith(c.dial)) {
      return { iso2: c.iso2, local: trimmed.slice(c.dial.length).trim() }
    }
  }
  return { iso2: DEFAULT_COUNTRY_ISO, local: trimmed }
}
