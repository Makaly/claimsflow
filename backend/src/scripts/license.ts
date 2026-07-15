/**
 * License issuer CLI (E7) — run by CIC, NEVER deployed to customers.
 *
 * Generates the signing keypair and mints signed license tokens. The private
 * key stays here / in a secret store; only the PUBLIC key (LICENSE_PUBLIC_KEY)
 * is shipped to deployments for offline verification.
 *
 *   # one-time: generate an Ed25519 keypair (prints both PEMs)
 *   npx ts-node src/scripts/license.ts keygen
 *
 *   # mint a token (private key from env LICENSE_PRIVATE_KEY)
 *   npx ts-node src/scripts/license.ts mint \
 *     --tenant <tenantId|null> --plan pro --type PRO --to "Acme Insurance Ltd" \
 *     --enforce --months 12
 *
 * The printed token is pasted into the admin UI (POST /licenses/install)
 * or dropped into a LICENSE_TOKEN env var for on-prem auto-install at boot.
 */
import { generateKeyPairSync, randomUUID } from 'crypto';
import { LicenseCryptoService, LicensePayload } from '../licensing/license-crypto.service';
import { PLANS, PlanId, MetricKey, LicenseType } from '../licensing/plans';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Default licence variant for a plan when --type isn't supplied. */
const TYPE_FOR_PLAN: Record<PlanId, LicenseType> = { core: 'CORE', pro: 'PRO', enterprise: 'ENTERPRISE' };

function keygen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  console.log('# PUBLIC KEY — set as LICENSE_PUBLIC_KEY on every deployment\n');
  console.log(publicKey);
  console.log('# PRIVATE KEY — keep secret, set as LICENSE_PRIVATE_KEY on the issuer only\n');
  console.log(privateKey);
}

function mint() {
  const privateKey = process.env.LICENSE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) throw new Error('LICENSE_PRIVATE_KEY env var is required to mint');

  const tenantArg = arg('tenant');
  const tenantId = !tenantArg || tenantArg === 'null' ? null : tenantArg;
  const plan = (arg('plan', 'core') as PlanId) ?? 'core';
  if (!PLANS[plan]) throw new Error(`Unknown plan '${plan}'. Valid: ${Object.keys(PLANS).join(', ')}`);
  const licenseType = (arg('type', TYPE_FOR_PLAN[plan]) as LicenseType) ?? TYPE_FOR_PLAN[plan];

  const months = Number(arg('months', '12'));
  const now = Math.floor(Date.now() / 1000);
  const exp = months > 0 ? now + months * 30 * 86_400 : null;

  // Start from the plan catalog; allow per-deal limit overrides like --claims 200000.
  const limits: Partial<Record<MetricKey, number>> = { ...PLANS[plan].limits };
  for (const m of ['claims', 'extractions', 'seats'] as MetricKey[]) {
    const v = arg(m);
    if (v !== undefined) limits[m] = Number(v);
  }

  const payload: LicensePayload = {
    lic: randomUUID(),
    tenantId,
    issuedTo: arg('to', 'Unspecified')!,
    plan,
    licenseType,
    features: PLANS[plan].features,
    limits,
    enforcement: has('enforce') ? 'enforce' : 'report',
    iat: now,
    exp,
    graceDays: Number(arg('grace', '14')),
  };

  const token = LicenseCryptoService.sign(payload, privateKey);
  console.error('# Minted license:', JSON.stringify({ ...payload, features: payload.features.length + ' features' }, null, 2));
  console.error('# Token (paste into POST /licenses/install or set LICENSE_TOKEN):\n');
  console.log(token); // stdout = token only, so it pipes cleanly
}

const cmd = process.argv[2];
if (cmd === 'keygen') keygen();
else if (cmd === 'mint') mint();
else {
  console.error('Usage: license.ts <keygen|mint> [--tenant id] [--plan core|pro|enterprise]');
  console.error('                  [--type TRIAL|CORE|PRO|ENTERPRISE|ON_PREM]');
  console.error('                  [--to "Name"] [--months N] [--enforce] [--grace N]');
  console.error('                  [--claims N] [--extractions N] [--seats N]');
  process.exit(1);
}
