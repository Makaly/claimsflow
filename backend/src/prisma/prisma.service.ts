import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { execSync } from 'child_process';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { decryptField, encryptField } from '../common/services/field-encryption';

/**
 * Models and string fields that hold special-category personal data and must
 * be encrypted at rest (GDPR Art. 9 / KDPA s.44-46). The middleware below
 * intercepts every read/write against these models so the rest of the
 * codebase keeps using plain string assignments.
 */
const ENCRYPTED_FIELDS: Record<string, ReadonlyArray<string>> = {
  // GDPR Art. 9 / KDPA s.44-46: health data must be encrypted at rest.
  // All string fields below are encrypted by the write middleware and
  // decrypted transparently on read. Add new fields here — never inline.
  Claim:         ['diagnosis', 'treatment', 'rejectionReason'],
  OcrExtraction: ['diagnosis', 'memberName', 'patientName'],
};

type AnyObject = Record<string, any>;

function encryptWritePayload(model: string, data: AnyObject | undefined | null): void {
  if (!data || typeof data !== 'object') return;
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string') {
      data[field] = encryptField(value);
    } else if (value && typeof value === 'object' && typeof value.set === 'string') {
      // Prisma update form: { field: { set: '…' } }
      value.set = encryptField(value.set);
    }
  }
}

function decryptRow(model: string, row: AnyObject | undefined | null): void {
  if (!row || typeof row !== 'object') return;
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') {
      row[field] = decryptField(value);
    }
  }
}

function decryptResult(model: string, result: any): any {
  if (result == null) return result;
  if (Array.isArray(result)) {
    for (const row of result) decryptRow(model, row);
  } else {
    decryptRow(model, result);
  }
  return result;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7 removed the built-in Rust query engine; PostgreSQL connections
    // now go through the @prisma/adapter-pg driver adapter. DATABASE_URL is
    // loaded by @nestjs/config (ConfigModule.forRoot) before Nest instantiates
    // this provider, so process.env.DATABASE_URL is populated here.
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    // Prisma 6 removed the `$use` middleware API, so the GDPR field-encryption
    // layer is now a `$extends` query extension (the documented replacement).
    // `$extends` returns a NEW client instead of mutating `this`, so we return
    // a Proxy from the constructor: model/operation access is routed to the
    // extended client (encryption applied), while our Nest lifecycle hooks
    // (onModuleInit/onModuleDestroy) stay bound to this base instance. The rest
    // of the codebase keeps calling `prisma.claim.findMany(...)` unchanged.
    const base = this;
    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const encrypted = !!ENCRYPTED_FIELDS[model];
            if (encrypted) {
              if (operation === 'create' || operation === 'update') {
                encryptWritePayload(model, (args as AnyObject)?.data);
              } else if (operation === 'upsert') {
                encryptWritePayload(model, (args as AnyObject)?.create);
                encryptWritePayload(model, (args as AnyObject)?.update);
              } else if (operation === 'updateMany' || operation === 'createMany') {
                // createMany accepts data: T | T[]
                const d = (args as AnyObject)?.data;
                if (Array.isArray(d)) d.forEach(row => encryptWritePayload(model, row));
                else encryptWritePayload(model, d);
              }
            }
            const result = await query(args);
            if (encrypted) return decryptResult(model, result);
            return result;
          },
        },
      },
    });

    return new Proxy(extended, {
      get(target, prop, receiver) {
        // Nest lifecycle hooks are defined on the PrismaService class, not on
        // the extended client — route them to the base instance. ($connect /
        // $disconnect called inside them share the same underlying engine.)
        if (prop === 'onModuleInit' || prop === 'onModuleDestroy') {
          return (base as AnyObject)[prop].bind(base);
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    // Apply any pending migrations before accepting connections.
    // migrate deploy is idempotent — no-op when the schema is already current.
    // Dockerfile.prod runs scripts/migrate.js first, so this is a safety net
    // for local dev and any non-Docker start path (e.g. npm run start:dev).
    try {
      console.log('[startup] running prisma migrate deploy…');
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      console.log('[startup] migrations up to date');
    } catch (err) {
      console.error('[startup] prisma migrate deploy failed — refusing to start:', err);
      process.exit(1);
    }

    await this.$connect();
    console.log('Database connected');
    // Validate encryption key at startup so mis-configured deployments fail
    // loudly rather than producing a 500 on the first claim with a diagnosis
    // or treatment value. DATA_ENCRYPTION_KEY must be 64 lowercase hex chars
    // (openssl rand -hex 32). Render's generateValue does not guarantee this
    // format — set it manually in the Render dashboard.
    const dek = process.env.DATA_ENCRYPTION_KEY;
    if (!dek || !/^[0-9a-f]{64}$/i.test(dek)) {
      console.error(
        '[startup] DATA_ENCRYPTION_KEY is missing or not a 64-char hex string. ' +
        'Generate one with: openssl rand -hex 32  and set it in the Render dashboard. ' +
        'Claims with diagnosis/treatment fields will 500 until this is fixed.',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
