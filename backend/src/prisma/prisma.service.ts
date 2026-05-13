import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptField, encryptField } from '../common/services/field-encryption';

/**
 * Models and string fields that hold special-category personal data and must
 * be encrypted at rest (GDPR Art. 9 / KDPA s.44-46). The middleware below
 * intercepts every read/write against these models so the rest of the
 * codebase keeps using plain string assignments.
 */
const ENCRYPTED_FIELDS: Record<string, ReadonlyArray<string>> = {
  Claim:         ['diagnosis', 'treatment'],
  OcrExtraction: ['diagnosis'],
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
    super();
    // Prisma 5 still supports $use; we use it (rather than $extends) because
    // it intercepts on the same client instance, so the rest of the codebase
    // can keep calling `prisma.claim.findMany(...)` without changes.
    this.$use(async (params, next) => {
      const model = params.model;
      if (model && ENCRYPTED_FIELDS[model]) {
        const action = params.action;
        if (action === 'create' || action === 'update') {
          encryptWritePayload(model, params.args?.data);
        } else if (action === 'upsert') {
          encryptWritePayload(model, params.args?.create);
          encryptWritePayload(model, params.args?.update);
        } else if (action === 'updateMany' || action === 'createMany') {
          // createMany accepts data: T | T[]
          const d = params.args?.data;
          if (Array.isArray(d)) d.forEach(row => encryptWritePayload(model, row));
          else encryptWritePayload(model, d);
        }
      }
      const result = await next(params);
      if (model && ENCRYPTED_FIELDS[model]) return decryptResult(model, result);
      return result;
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
