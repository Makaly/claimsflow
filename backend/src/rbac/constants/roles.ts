// Default system roles mapped to their permission set.
// These are seeded on startup and kept in sync with the string roles already
// referenced throughout the codebase.
//
// Role layout (2026-05-14 maker-checker refactor):
//   - admin           : full system administration
//   - claims_officer  : final invoice approver; brokers provider back-and-forth and appeals
//   - maker_checker   : verifies captured invoice data, merges invoices, document QA
//   - fraud_officer   : confirms or clears fraud; participates in three-party appeals
//   - finance         : marks payments paid
//   - provider_admin  : provider organisation owner (uploads invoices, manages branches)
//   - provider_user   : provider staff at a branch (uploads invoices)
//   - user            : read-only safe default
//
// `supervisor` and `checker` were removed in this refactor:
//   - existing supervisor users are migrated to `claims_officer`
//   - existing checker users are migrated to `maker_checker`

import { PERMISSION_NAMES } from './permissions';

export interface RoleDef {
  name: string;
  displayName: string;
  description: string;
  permissions: string[]; // permission names (resource.action)
}

// Admin gets every permission in the catalogue.
const ADMIN_PERMISSIONS = [...PERMISSION_NAMES];

export const DEFAULT_ROLES: RoleDef[] = [
  {
    name: 'admin',
    displayName: 'System Administrator',
    description: 'Full access to every resource and action.',
    permissions: ADMIN_PERMISSIONS,
  },
  {
    name: 'claims_officer',
    displayName: 'Claims Officer',
    description: 'Final approver of invoices; brokers provider follow-up and appeals.',
    permissions: [
      'claims.read', 'claims.update', 'claims.assign', 'claims.review',
      'claims.approve', 'claims.reject', 'claims.flag_fraud',
      'documents.read', 'documents.annotate', 'documents.stamp',
      'documents.sign',
      'users.read',
      'providers.read',
      'branches.read',
      'batches.read',
      'reports.read', 'reports.run', 'reports.export',
      'activity_logs.read',
    ],
  },
  {
    name: 'maker_checker',
    displayName: 'Maker-Checker',
    description: 'Verifies captured invoice data, merges/splits invoices, performs document QA.',
    permissions: [
      'claims.read', 'claims.update', 'claims.review',
      'claims.approve', 'claims.reject', 'claims.flag_fraud',
      'documents.read', 'documents.annotate', 'documents.stamp',
      'documents.sign', 'documents.merge', 'documents.split',
      'providers.read', 'branches.read', 'batches.read',
      'reports.read', 'reports.run',
    ],
  },
  {
    name: 'fraud_officer',
    displayName: 'Fraud Officer',
    description: 'Investigates and confirms or clears fraudulent claims.',
    permissions: [
      'claims.read', 'claims.flag_fraud', 'claims.reject',
      'documents.read', 'documents.annotate',
      'providers.read', 'branches.read',
      'reports.read', 'reports.run', 'reports.export',
      'activity_logs.read',
    ],
  },
  {
    name: 'finance',
    displayName: 'Finance Officer',
    description: 'Confirms and records payments for approved invoices.',
    permissions: [
      'claims.read',
      'documents.read',
      'providers.read', 'branches.read',
      'reports.read', 'reports.run', 'reports.export',
    ],
  },
  {
    name: 'provider_admin',
    displayName: 'Provider Administrator',
    description: 'Manages their provider organisation, branches and staff.',
    permissions: [
      'claims.read', 'claims.create', 'claims.update', 'claims.resubmit',
      'documents.read', 'documents.upload',
      'providers.read', 'providers.update',
      'branches.read', 'branches.create', 'branches.update',
      'batches.read', 'batches.create',
      'users.read', 'users.create', 'users.update',
      'reports.read', 'reports.run',
    ],
  },
  {
    name: 'provider_user',
    displayName: 'Provider User',
    description: 'Submits and tracks claims for their branch.',
    permissions: [
      'claims.read', 'claims.create', 'claims.resubmit',
      'documents.read', 'documents.upload',
      'batches.read', 'batches.create',
      'providers.read', 'branches.read',
    ],
  },
  {
    name: 'user',
    displayName: 'Basic User',
    description: 'Read-only access, used as a safe default.',
    permissions: [
      'claims.read', 'documents.read',
    ],
  },
];
