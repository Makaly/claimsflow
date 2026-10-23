/**
 * Plan catalog & tier matrix — the single source of truth for what each
 * ClaimsFlow licence tier includes. Mirrors the helpdesk licensing model:
 *
 *  - FEATURES / METRICS    machine keys (stable; go into signed tokens & DB rows)
 *  - PLANS                 entitlement plan → feature keys + metered limits
 *  - PLAN_LEVEL            numeric rank for route-prefix gating (FeatureGate)
 *  - PLAN_LICENSE_DEFAULTS per-licenseType caps + term length
 *  - TIER_MATRIX           marketing-grade manifest (price, caps, human feature
 *                          lists) served publicly at GET /licenses/tiers and
 *                          reused in /verify responses and the PDF certificate.
 *
 * The signed token always wins at runtime (cryptographic source of truth); this
 * catalog is what the issuer mints FROM and what an unlicensed/trial tenant
 * falls back to.
 */

/** Entitlement plan tier (what a tenant effectively gets). */
export type PlanId = 'core' | 'pro' | 'enterprise';

/** Licence product variant (what was sold). Maps onto a PlanId. */
export type LicenseType = 'TRIAL' | 'CORE' | 'PRO' | 'ENTERPRISE' | 'ON_PREM';

/** Licence lifecycle state. */
export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';

/** Every gateable capability. Decorators reference these by string. */
export const FEATURES = {
  CLAIMS_INTAKE: 'claims_intake',
  OCR_EXTRACTION: 'ocr_extraction',
  FRAUD_SCORING: 'fraud_scoring',
  BILLING_AUDIT: 'billing_audit',
  APPEALS_CASES: 'appeals_cases',
  PROVIDER_PORTAL: 'provider_portal',
  CUSTOM_JOB_SETUPS: 'custom_job_setups',
  MULTI_BRANCH: 'multi_branch',
  WHITE_LABEL: 'white_label',
  SSO_ENFORCED: 'sso_enforced',
  API_ACCESS: 'api_access',
  AUDIT_LOGS: 'audit_logs',
  ON_PREM_DEPLOYMENT: 'on_prem_deployment',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

/** Metered resources. Keep in sync with UsageCounter.metric values. */
export const METRICS = {
  CLAIMS: 'claims',
  EXTRACTIONS: 'extractions',
  SEATS: 'seats',
} as const;

export type MetricKey = (typeof METRICS)[keyof typeof METRICS];

export interface PlanDefinition {
  features: FeatureKey[];
  /** null/absent metric = unlimited. */
  limits: Partial<Record<MetricKey, number>>;
}

const CORE_FEATURES: FeatureKey[] = [FEATURES.CLAIMS_INTAKE, FEATURES.OCR_EXTRACTION];

const PRO_FEATURES: FeatureKey[] = [
  ...CORE_FEATURES,
  FEATURES.FRAUD_SCORING,
  FEATURES.BILLING_AUDIT,
  FEATURES.APPEALS_CASES,
  FEATURES.PROVIDER_PORTAL,
  FEATURES.CUSTOM_JOB_SETUPS,
];

export const PLANS: Record<PlanId, PlanDefinition> = {
  core: {
    features: CORE_FEATURES,
    limits: { claims: 5_000, extractions: 10_000, seats: 10 },
  },
  pro: {
    features: PRO_FEATURES,
    limits: { claims: 50_000, extractions: 120_000, seats: 50 },
  },
  enterprise: {
    features: Object.values(FEATURES),
    // No limits → unlimited. Internal CIC issues this in 'report' mode.
    limits: {},
  },
};

/**
 * Numeric plan rank for route-prefix feature gating (mirrors helpdesk
 * PLAN_LEVEL). A request path resolves to a required level; tenants below it
 * get 403 PLAN_UPGRADE_REQUIRED. TRIAL deliberately gets PRO-level access so
 * prospects can evaluate paid features.
 */
export const PLAN_LEVEL: Record<PlanId, number> = { core: 1, pro: 2, enterprise: 3 };

/** Sentinel cap meaning "unlimited" (mirrors helpdesk's 999999). */
export const UNLIMITED = 999_999;

export interface LicenseDefaults {
  plan: PlanId;
  maxSeats: number;
  maxClaimsPerMonth: number;
  maxExtractionsPerMonth: number;
  /** Term length in days. 0 = perpetual (on-prem lifetime). */
  durationDays: number;
}

/** Caps + term per licence product variant. Used when applying a licence. */
export const PLAN_LICENSE_DEFAULTS: Record<LicenseType, LicenseDefaults> = {
  TRIAL: { plan: 'pro', maxSeats: 10, maxClaimsPerMonth: 1_000, maxExtractionsPerMonth: 2_000, durationDays: 14 },
  CORE: { plan: 'core', maxSeats: 10, maxClaimsPerMonth: 5_000, maxExtractionsPerMonth: 10_000, durationDays: 365 },
  PRO: { plan: 'pro', maxSeats: 50, maxClaimsPerMonth: 50_000, maxExtractionsPerMonth: 120_000, durationDays: 365 },
  ENTERPRISE: { plan: 'enterprise', maxSeats: UNLIMITED, maxClaimsPerMonth: UNLIMITED, maxExtractionsPerMonth: UNLIMITED, durationDays: 365 },
  ON_PREM: { plan: 'enterprise', maxSeats: 100, maxClaimsPerMonth: UNLIMITED, maxExtractionsPerMonth: UNLIMITED, durationDays: 365 },
};

/** Collapse a licence variant onto its entitlement plan. */
export function planForLicenseType(type: LicenseType): PlanId {
  return PLAN_LICENSE_DEFAULTS[type]?.plan ?? 'core';
}

export interface TierManifest {
  id: PlanId;
  label: string;
  /** Display price, e.g. "KES 4,500 / claims officer / month". */
  price: string;
  maxSeats: string;
  maxClaimsPerMonth: string;
  maxExtractionsPerMonth: string;
  /** Human-readable feature bullets (marketing copy). */
  features: string[];
}

/**
 * Marketing-grade tier manifest. Served at GET /licenses/tiers and rendered in
 * the admin UI + PDF certificate. Keep in lock-step with PLANS above.
 */
export const TIER_MATRIX: TierManifest[] = [
  {
    id: 'core',
    label: 'Core',
    price: 'KES 4,500 / officer / month',
    maxSeats: '10',
    maxClaimsPerMonth: '5,000',
    maxExtractionsPerMonth: '10,000',
    features: [
      'Claims intake & registration',
      'AI document OCR & extraction',
      'Document management & batches',
      'Standard workflow & assignment',
      'Role-based access (core roles)',
      'Email & in-app notifications',
      'Standard reporting dashboard',
    ],
  },
  {
    id: 'pro',
    label: 'Professional',
    price: 'KES 8,500 / officer / month',
    maxSeats: '50',
    maxClaimsPerMonth: '50,000',
    maxExtractionsPerMonth: '120,000',
    features: [
      'Everything in Core, plus:',
      'AI fraud scoring & risk flags',
      'Billing vs diagnosis audit',
      'Appeals & case management',
      'Provider self-service portal',
      'Custom job setups & indexing',
      'Provider intelligence learning loop',
      'Advanced SLA & breach alerts',
    ],
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    price: 'Custom',
    maxSeats: 'Unlimited',
    maxClaimsPerMonth: 'Unlimited',
    maxExtractionsPerMonth: 'Unlimited',
    features: [
      'Everything in Professional, plus:',
      'Multi-branch / multi-entity',
      'White-label & custom branding',
      'Enforced SSO / SAML',
      'Immutable audit logs',
      'Full API access & integrations',
      'On-premise / air-gapped deployment',
      'Dedicated account manager',
      '99.9% uptime SLA & white-glove onboarding',
    ],
  },
];

/** Day-before-expiry milestones at which a reminder email fires (once each). */
export const REMINDER_DAYS = [90, 60, 30, 7, 0] as const;
