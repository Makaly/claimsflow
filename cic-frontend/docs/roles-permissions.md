# Roles & Permissions Reference

This document describes every role in the system, what it represents, and which pages and actions it can access.

---

## Roles

| Role | Description |
|---|---|
| `admin` | Full system administrator. Unrestricted access to all features including user management, RBAC configuration, and system settings. |
| `supervisor` | Operations supervisor. Oversees workflow queues, approves providers, views all reports, and can intervene in any claim stage. |
| `claims_officer` | Responsible for initial claim intake and maker-stage review. Submits claims, processes the Maker Queue, and handles batch uploads. |
| `checker` | Second-level reviewer. Works the Checker Queue, validates claims passed from makers, and makes approve / reject / return decisions. |
| `fraud_officer` | Fraud investigator. Reviews claims flagged for potential fraud in the Fraud Queue. Read-heavy role focused on investigation. |
| `provider_admin` | Administrator of a provider organisation. Manages provider profile, branches, and users within their organisation. |
| `provider_user` | Individual user within a provider organisation, scoped to a specific branch. Submits claims on behalf of the branch. |

---

## Route Access Matrix

| Route | `admin` | `supervisor` | `claims_officer` | `checker` | `fraud_officer` | `provider_admin` | `provider_user` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `/claims` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `/maker-queue` | ✅ | ✅ | ✅ | — | — | — | — |
| `/checker-queue` | ✅ | ✅ | — | ✅ | — | — | — |
| `/fraud-queue` | ✅ | ✅ | — | — | ✅ | — | — |
| `/workflow` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `/providers` | ✅ | ✅ | — | — | — | — | — |
| `/provider-approvals` | ✅ | ✅ | — | — | — | — | — |
| `/provider-dashboard` | — | — | — | — | — | ✅ | ✅ |
| `/batch-upload` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `/documents` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/unknown-documents` | ✅ | ✅ | ✅ | — | — | — | — |
| `/reports` | ✅ | ✅ | — | — | — | — | — |
| `/activity-logs` | ✅ | ✅ | — | — | ✅ | — | — |
| `/users` | ✅ | — | — | — | — | — | — |
| `/roles` | ✅ | — | — | — | — | — | — |
| `/permissions` | ✅ | — | — | — | — | — | — |
| `/settings` | ✅ | — | — | — | — | — | — |
| `/branches` | ✅ | ✅ | — | — | — | ✅ | — |
| `/profile` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/2fa-setup` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Claim Workflow Permissions

| Action | `admin` | `supervisor` | `claims_officer` | `checker` | `fraud_officer` | `provider_admin` | `provider_user` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Submit new claim | ✅ | — | ✅ | — | — | ✅ | ✅ |
| View claim details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* | ✅* |
| Maker-stage approve | ✅ | ✅ | ✅ | — | — | — | — |
| Checker-stage approve | ✅ | ✅ | — | ✅ | — | — | — |
| Flag for fraud | ✅ | ✅ | — | ✅ | — | — | — |
| Fraud decision | ✅ | ✅ | — | — | ✅ | — | — |
| Final approval | ✅ | ✅ | — | — | — | — | — |
| Reject (any stage) | ✅ | ✅ | ✅** | ✅** | ✅** | — | — |
| Return to maker | ✅ | ✅ | — | ✅ | — | — | — |

\* Provider users see only their own organisation's claims  
\*\* Rejection is limited to the role's assigned queue stage

---

## Provider Workflow Permissions

| Action | `admin` | `supervisor` | `provider_admin` | Others |
|---|:---:|:---:|:---:|:---:|
| Create provider | ✅ | — | — | — |
| View providers | ✅ | ✅ | ✅* | — |
| Edit provider profile | ✅ | — | ✅* | — |
| Approve / reject provider | ✅ | ✅ | — | — |
| Suspend provider | ✅ | ✅ | — | — |
| Manage branches | ✅ | ✅ | ✅* | — |
| Onboarding review | ✅ | ✅ | — | — |

\* Scoped to own organisation only

---

## How Permissions Are Enforced

Permissions are enforced at two levels:

### 1. Route Level — `ProtectedRoute` in `src/App.tsx`

```tsx
<ProtectedRoute allowedRoles={['admin', 'supervisor']}>
  <Reports />
</ProtectedRoute>
```

If the authenticated user's role is not in `allowedRoles`, a 403 screen is rendered instead.

### 2. UI Level — Conditional Rendering

Individual UI elements (buttons, menu items, table actions) check `authStore` and conditionally render based on role:

```tsx
const { user } = useAuthStore()

{user?.role === 'admin' && (
  <Button onClick={handleDelete}>Delete User</Button>
)}
```

### 3. API Level

All business-rule enforcement (e.g. a checker cannot approve their own maker submission) is validated on the backend. The frontend guards are for UX only — the API is the authoritative source of truth for permissions.
