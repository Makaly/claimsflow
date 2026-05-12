// Default system roles mapped to their permission set.
// These are seeded on startup and kept in sync with the string roles already
// referenced throughout the codebase (admin, claims_officer, supervisor,
// provider_admin, provider_user, fraud_officer).

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
    name: 'supervisor',
    displayName: 'Claims Supervisor',
    description: 'Oversees claim processing; can approve and reassign.',
    permissions: [
      'claims.read', 'claims.update', 'claims.assign', 'claims.review',
      'claims.approve', 'claims.reject', 'claims.flag_fraud',
      'documents.read', 'documents.annotate', 'documents.stamp',
      'documents.sign', 'documents.merge', 'documents.split',
      'users.read',
      'providers.read',
      'branches.read',
      'batches.read',
      'reports.read', 'reports.run', 'reports.export',
      'activity_logs.read',
    ],
  },
  {
    name: 'claims_officer',
    displayName: 'Claims Officer',
    description: 'Reviews and processes individual claims.',
    permissions: [
      'claims.read', 'claims.update', 'claims.review',
      'claims.approve', 'claims.reject',
      'documents.read', 'documents.annotate', 'documents.stamp',
      'documents.sign',
      'providers.read', 'branches.read', 'batches.read',
      'reports.read', 'reports.run',
    ],
  },
  {
    name: 'fraud_officer',
    displayName: 'Fraud Officer',
    description: 'Investigates and flags fraudulent claims.',
    permissions: [
      'claims.read', 'claims.flag_fraud', 'claims.reject',
      'documents.read', 'documents.annotate',
      'providers.read', 'branches.read',
      'reports.read', 'reports.run', 'reports.export',
      'activity_logs.read',
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
