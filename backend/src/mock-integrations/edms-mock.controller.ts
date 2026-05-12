import {
  Controller, Get, Post, Headers, Body, Param, BadRequestException, UnauthorizedException, Logger,
} from '@nestjs/common';

interface MockEdmsDocument {
  id: string;
  fileName: string;
  metadata: any;
  barcode?: string;
  indexKey?: string;
  uploadedAt: string;
}

@Controller('mock-edms')
export class EdmsMockController {
  private readonly logger = new Logger(EdmsMockController.name);
  private readonly EXPECTED_KEY = 'mock-edms-key-dev';
  private documents = new Map<string, MockEdmsDocument>();

  private auth(headers: Record<string, string>) {
    const auth = headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== this.EXPECTED_KEY) {
      throw new UnauthorizedException('Mock EDMS: invalid API key');
    }
  }

  @Post('documents')
  uploadDocument(@Headers() headers: any, @Body() body: any) {
    this.auth(headers);
    const id = `EDMS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const doc: MockEdmsDocument = {
      id,
      fileName: body.fileName || 'unknown.pdf',
      metadata: body.metadata || {},
      barcode: body.barcode,
      indexKey: body.indexKey || `IDX-${id}`,
      uploadedAt: new Date().toISOString(),
    };
    this.documents.set(id, doc);
    this.logger.log(`Mock EDMS received document: ${doc.fileName} → ${id}`);
    return {
      documentId: id,
      barcode: doc.barcode,
      indexKey: doc.indexKey,
      status: 'archived',
      archivedAt: doc.uploadedAt,
    };
  }

  @Get('documents/:id')
  getDocument(@Headers() headers: any, @Param('id') id: string) {
    this.auth(headers);
    const doc = this.documents.get(id);
    if (!doc) throw new BadRequestException(`Document ${id} not in mock EDMS`);
    return doc;
  }

  @Get('health')
  health() {
    return { service: 'mock-edms', status: 'ok', documents: this.documents.size };
  }
}
