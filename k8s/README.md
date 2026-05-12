# Kubernetes manifests

Starter manifests for ClaimsFlow. Designed to pass `kubeval` and `kube-linter`
out of the box.

## Files

| File             | Resource(s)                              |
| ---------------- | ---------------------------------------- |
| `namespace.yaml` | `Namespace` (Pod Security Admission: restricted) |
| `backend.yaml`   | `Deployment` + `Service` for the NestJS API |
| `frontend.yaml`  | `Deployment` + `Service` for the SPA      |

## Required secrets

A `Secret` named `claimsflow-secrets` must exist in the `claimsflow` namespace
with these keys:

| Key            | Source                                                    |
| -------------- | --------------------------------------------------------- |
| `database-url` | Postgres connection string (`postgresql://…`)             |
| `jwt-secret`   | 32+ byte random string — rotate per the security policy   |

Create with:

```bash
kubectl create secret generic claimsflow-secrets -n claimsflow \
  --from-literal=database-url='…' \
  --from-literal=jwt-secret="$(openssl rand -hex 32)"
```

## Linting

```bash
# Schema validation
kubeval k8s/*.yaml

# Best-practice / policy linting
kube-linter lint k8s/
```

Both run in CI.
