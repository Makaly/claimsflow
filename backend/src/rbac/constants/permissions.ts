// Canonical permission catalogue. Anything granted via roles must appear here.
// Name is always "<resource>.<action>". Keep resources lowercase plural-ish.

export interface PermissionDef {
  name: string;
  resource: string;
  action: string;
  description: string;
}

function p(resource: string, action: string, description: string): PermissionDef {
  return { name: `${resource}.${action}`, resource, action, description };
}

export const PERMISSIONS: PermissionDef[] = [
  // Claims
  p('claims', 'read', 'View claims'),
  p('claims', 'create', 'Create/submit claims'),
  p('claims', 'update', 'Edit claim details'),
  p('claims', 'delete', 'Delete a claim'),
  p('claims', 'assign', 'Assign claim to an officer'),
  p('claims', 'review', 'Initial review of a claim'),
  p('claims', 'approve', 'Approve a claim (maker/checker/final)'),
  p('claims', 'reject', 'Reject a claim'),
  p('claims', 'resubmit', 'Resubmit a rejected claim'),
  p('claims', 'flag_fraud', 'Flag claim as fraud'),

  // Documents
  p('documents', 'read', 'View documents'),
  p('documents', 'upload', 'Upload documents'),
  p('documents', 'delete', 'Delete documents'),
  p('documents', 'annotate', 'Add annotations'),
  p('documents', 'stamp', 'Apply stamp annotations'),
  p('documents', 'sign', 'Sign documents'),
  p('documents', 'redact', 'Add redaction annotations'),
  p('documents', 'merge', 'Merge documents'),
  p('documents', 'split', 'Split documents'),
  p('documents', 'purge', 'Request or approve document purges'),

  // Users
  p('users', 'read', 'View users'),
  p('users', 'create', 'Create users'),
  p('users', 'update', 'Update users'),
  p('users', 'delete', 'Delete users'),
  p('users', 'activate', 'Activate/deactivate users'),
  p('users', 'reset_password', 'Reset another user\'s password'),

  // Providers
  p('providers', 'read', 'View providers'),
  p('providers', 'create', 'Create providers'),
  p('providers', 'update', 'Update providers'),
  p('providers', 'delete', 'Delete providers'),
  p('providers', 'approve', 'Approve provider registration'),
  p('providers', 'suspend', 'Suspend a provider'),

  // Branches
  p('branches', 'read', 'View branches'),
  p('branches', 'create', 'Create branches'),
  p('branches', 'update', 'Update branches'),
  p('branches', 'delete', 'Delete branches'),

  // Batch submissions
  p('batches', 'read', 'View batch submissions'),
  p('batches', 'create', 'Create batches'),
  p('batches', 'update', 'Update batches'),
  p('batches', 'delete', 'Delete batches'),

  // Reports
  p('reports', 'read', 'View reports'),
  p('reports', 'create', 'Create reports'),
  p('reports', 'run', 'Execute reports'),
  p('reports', 'export', 'Export report results'),

  // RBAC administration
  p('roles', 'read', 'View roles'),
  p('roles', 'create', 'Create roles'),
  p('roles', 'update', 'Update roles (including permission grants)'),
  p('roles', 'delete', 'Delete roles'),
  p('roles', 'assign', 'Assign/revoke roles on users'),
  p('permissions', 'read', 'View permissions'),
  p('permissions', 'create', 'Create custom permissions'),
  p('permissions', 'delete', 'Delete custom permissions'),

  // System / audit
  p('system_config', 'read', 'View system configuration'),
  p('system_config', 'update', 'Update system configuration'),
  p('activity_logs', 'read', 'View activity logs'),
];

export const PERMISSION_NAMES = PERMISSIONS.map((x) => x.name);
