# CIC Medical Claims Automation - Next Steps Guide

**Quick Reference**: What to do right now to continue implementation

---

## 🚀 IMMEDIATE ACTIONS (Today)

### Step 1: Install Backend Dependencies (10 minutes)

```bash
cd /home/bigdev/Desktop/cic/claims/backend
npm install
```

**What this does**:
- Installs all 73 backend packages
- Includes new packages: pdf-lib, sharp, bwip-js, twilio, africastalking, exceljs, etc.
- May take 5-10 minutes depending on internet speed

**Expected Issues**:
- `bcrypt` may fail (requires Python, make, g++)
- **Solution**: Use Docker (automatically handles build dependencies)

---

### Step 2: Run Database Migrations (2 minutes)

```bash
cd /home/bigdev/Desktop/cic/claims/backend

# Generate Prisma Client from updated schema
npx prisma generate

# Create and apply migrations
npx prisma migrate dev --name complete_srd_implementation

# Optional: Open Prisma Studio to view database
npx prisma studio
```

**What this does**:
- Creates all 20+ database tables
- Sets up relationships and indexes
- Generates TypeScript types for database access

---

### Step 3: Create Upload Directories (30 seconds)

```bash
cd /home/bigdev/Desktop/cic/claims/backend
mkdir -p uploads/claims uploads/documents uploads/temp uploads/tiff uploads/processed
```

---

### Step 4: Test PDF Services (5 minutes)

Create a test script to verify the new services work:

**File**: `/home/bigdev/Desktop/cic/claims/backend/test-pdf-services.ts`

```typescript
import { BarcodeService } from './src/common/services/barcode.service';
import { PdfWatermarkService } from './src/common/services/pdf-watermark.service';
import { TiffConverterService } from './src/common/services/tiff-converter.service';
import { PdfOperationsService } from './src/common/services/pdf-operations.service';

async function testServices() {
  const barcodeService = new BarcodeService();
  const pdfWatermarkService = new PdfWatermarkService();

  console.log('🧪 Testing Services...\n');

  // Test 1: Generate Barcode
  console.log('1. Testing Barcode Generation...');
  const batchNumber = barcodeService.generateBatchNumber(1);
  const folioNumber = barcodeService.generateFolioNumber(1);
  const barcode = await barcodeService.generateClaimBarcode(batchNumber, folioNumber);
  console.log(`   ✅ Barcode: ${barcode}`);

  // Test 2: Generate Barcode Image
  console.log('\n2. Testing Barcode Image Generation...');
  const barcodeImage = await barcodeService.generateBarcodeImage(barcode);
  console.log(`   ✅ Barcode Image: ${barcodeImage.length} bytes`);

  console.log('\n✅ All tests passed!');
}

testServices().catch(console.error);
```

Run it:
```bash
cd /home/bigdev/Desktop/cic/claims/backend
npx ts-node test-pdf-services.ts
```

---

## 📋 PRIORITY IMPLEMENTATIONS (This Week)

### Priority 1: Batch Submission Module (Day 1-2)

**Create these files**:

1. **Module**: `/backend/src/batch-submission/batch-submission.module.ts`
2. **Service**: `/backend/src/batch-submission/batch-submission.service.ts`
3. **Controller**: `/backend/src/batch-submission/batch-submission.controller.ts`
4. **Processor**: `/backend/src/batch-submission/batch-submission.processor.ts`

**Implementation**:
```typescript
// batch-submission.service.ts snippet
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';

@Injectable()
export class BatchSubmissionService {
  constructor(
    private prisma: PrismaService,
    private barcodeService: BarcodeService,
    private pdfWatermarkService: PdfWatermarkService,
    @InjectQueue('batch-processing') private batchQueue: Queue,
  ) {}

  async createBatchSubmission(providerId: string, files: Express.Multer.File[]) {
    // Generate batch number
    const count = await this.prisma.batchSubmission.count();
    const batchNumber = this.barcodeService.generateBatchNumber(count + 1);

    // Create batch record
    const batch = await this.prisma.batchSubmission.create({
      data: {
        batchNumber,
        providerId,
        submissionMethod: 'web_upload',
        totalClaims: files.length,
        status: 'processing',
      },
    });

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const folioNumber = this.barcodeService.generateFolioNumber(i + 1);
      const barcode = await this.barcodeService.generateClaimBarcode(batchNumber, folioNumber);

      // Generate barcode image
      const barcodeImage = await this.barcodeService.generateBarcodeImage(barcode);

      // Add watermark and barcode to PDF
      const processedPath = await this.pdfWatermarkService.addWatermarkAndBarcode(
        file.path,
        batchNumber,
        barcode,
        barcodeImage,
      );

      // Create claim
      await this.prisma.claim.create({
        data: {
          claimNumber: barcode,
          batchNumber,
          folioNumber,
          barcode,
          providerId,
          batchId: batch.id,
          status: 'submitted',
        },
      });
    }

    return batch;
  }
}
```

---

### Priority 2: Maker-Checker Workflow (Day 3-4)

**Create these files**:

1. **Module**: `/backend/src/workflow/workflow.module.ts`
2. **Service**: `/backend/src/workflow/maker-checker.service.ts`
3. **Controller**: `/backend/src/workflow/workflow.controller.ts`

**Key Functions**:
- `assignToMaker()` - Assign claim to first reviewer
- `makerApprove()` - First level approval
- `makerReject()` - First level rejection
- `assignToChecker()` - Route to second reviewer
- `checkerApprove()` - Final approval
- `finalApproval()` - Mark as complete

---

### Priority 3: Enhanced OCR (Day 5-7)

**Option A: Google Cloud Vision** (Recommended)

```bash
npm install @google-cloud/vision
```

**Setup**:
1. Create Google Cloud Project
2. Enable Vision API
3. Create Service Account
4. Download JSON key
5. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
   ```

**Implementation**:
```typescript
// google-vision.service.ts
import vision from '@google-cloud/vision';

@Injectable()
export class GoogleVisionService {
  private client = new vision.ImageAnnotatorClient();

  async extractText(imagePath: string): Promise<string> {
    const [result] = await this.client.textDetection(imagePath);
    return result.fullTextAnnotation?.text || '';
  }

  async extractFields(imagePath: string): Promise<OcrExtraction> {
    const text = await this.extractText(imagePath);

    // Parse mandatory fields
    return {
      memberNumber: this.extractMemberNumber(text),
      memberName: this.extractMemberName(text),
      providerName: this.extractProviderName(text),
      invoiceNumber: this.extractInvoiceNumber(text),
      invoiceDate: this.extractInvoiceDate(text),
      invoiceAmount: this.extractInvoiceAmount(text),
      overallConfidence: 0.95, // Google Vision typically 95%+
    };
  }
}
```

**Option B: AWS Textract**

```bash
npm install @aws-sdk/client-textract
```

---

## 🎯 WEEK-BY-WEEK IMPLEMENTATION PLAN

### Week 1: Core Workflow
- [x] PDF Services (DONE)
- [ ] Batch Submission Module
- [ ] Barcode Integration
- [ ] Provider Approval Workflow

### Week 2: Processing Workflow
- [ ] Maker-Checker Implementation
- [ ] Completeness Validation
- [ ] Assignment Strategies
- [ ] Claim Resubmission

### Week 3: OCR Enhancement
- [ ] Google Cloud Vision Setup
- [ ] Template Management
- [ ] Field Extraction Rules
- [ ] Manual Review Interface

### Week 4: Integrations
- [ ] EDMS Integration (need API docs)
- [ ] eOxegen Integration (need API docs)
- [ ] Email OAuth 2.0
- [ ] SMS Service

### Week 5-6: Frontend Enhancement
- [ ] Advanced PDF Viewer
- [ ] Batch Upload UI
- [ ] Approval Queue UI
- [ ] Admin Dashboard

### Week 7-8: Reporting & Testing
- [ ] Report Builder
- [ ] Excel/PDF Export
- [ ] Comprehensive Testing
- [ ] Performance Testing

---

## 📞 INFORMATION NEEDED FROM CIC

### Critical (Blocking Implementation)

1. **EDMS Integration**
   - API documentation
   - Test environment access
   - Sample data for testing
   - Authentication credentials

2. **eOxegen/Smart Integration**
   - API/database specifications
   - Data schema documentation
   - Test environment access
   - Sample data mapping

3. **Email OAuth 2.0**
   - Email provider (Google Workspace / Microsoft 365)
   - OAuth 2.0 credentials
   - Approved callback URLs

### Important (Not Blocking)

4. **SMS Gateway**
   - Preferred provider (AfricasTalking for Kenya)
   - Account setup assistance
   - Budget for SMS credits

5. **Infrastructure**
   - Cloud provider preference (AWS/Azure/GCP)
   - Server specifications
   - Database sizing requirements

6. **Security & Compliance**
   - Kenya Data Protection Act specific requirements
   - Existing security policies
   - Audit requirements

---

## 💡 QUICK WINS (Can Implement Today)

### 1. Provider Approval Workflow (2 hours)

**Update**: `/backend/src/providers/providers.controller.ts`

Add approval endpoint:
```typescript
@Post(':id/approve')
@UseGuards(JwtAuthGuard)
async approveProvider(
  @Param('id') id: string,
  @Request() req,
) {
  return this.providersService.approveProvider(id, req.user.userId);
}

@Post(':id/reject')
@UseGuards(JwtAuthGuard)
async rejectProvider(
  @Param('id') id: string,
  @Body() body: { reason: string },
) {
  return this.providersService.rejectProvider(id, body.reason);
}
```

### 2. Activity Logging Middleware (1 hour)

**Create**: `/backend/src/common/middleware/activity-logger.middleware.ts`

```typescript
@Injectable()
export class ActivityLoggerMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: Function) {
    const startTime = Date.now();

    res.on('finish', async () => {
      const duration = Date.now() - startTime;

      await this.prisma.activityLog.create({
        data: {
          userId: req.user?.userId,
          action: `${req.method} ${req.path}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          status: res.statusCode < 400 ? 'success' : 'failure',
          metadata: { duration },
        },
      });
    });

    next();
  }
}
```

### 3. Two-Factor Authentication (3 hours)

**Update**: `/backend/src/auth/auth.service.ts`

```typescript
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

async enable2FA(userId: string) {
  const secret = speakeasy.generateSecret({
    name: 'CIC Claims (user@example.com)',
  });

  // Save secret to database
  await this.prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: secret.base32,
      twoFactorEnabled: false, // Enable after verification
    },
  });

  // Generate QR code
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  return {
    secret: secret.base32,
    qrCode: qrCodeUrl,
  };
}

async verify2FA(userId: string, token: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token,
  });

  if (verified) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
  }

  return verified;
}
```

---

## 🐛 TROUBLESHOOTING

### Backend Install Fails

**Problem**: `bcrypt` compilation errors

**Solution 1**: Use Docker
```bash
docker-compose up -d backend
```

**Solution 2**: Install build tools
```bash
# Ubuntu/Debian
sudo apt-get install python3 make g++

# Then retry
npm install
```

### Database Connection Fails

**Check**:
```bash
# Ensure PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U postgres -h localhost
```

**Fix**: Update `.env` with correct DATABASE_URL

### Redis Connection Fails

**Check**:
```bash
# Ensure Redis is running
redis-cli ping
# Should return: PONG
```

**Fix**: Start Redis
```bash
sudo systemctl start redis
```

---

## 📚 LEARNING RESOURCES

### PDF Processing
- pdf-lib docs: https://pdf-lib.js.org/
- Sharp docs: https://sharp.pixelplumbing.com/
- bwip-js docs: https://github.com/metafloor/bwip-js

### OCR
- Google Cloud Vision: https://cloud.google.com/vision/docs
- AWS Textract: https://docs.aws.amazon.com/textract/
- Tesseract.js: https://tesseract.projectnaptha.com/

### NestJS
- Official docs: https://docs.nestjs.com/
- BullMQ: https://docs.bullmq.io/
- Prisma: https://www.prisma.io/docs/

---

## ✅ CHECKLIST - Before Moving Forward

- [ ] Backend dependencies installed successfully
- [ ] Database migrated (20+ tables created)
- [ ] Upload directories created
- [ ] PDF services tested and working
- [ ] Obtained EDMS API documentation
- [ ] Obtained eOxegen API documentation
- [ ] Decided on OCR provider (Google Cloud Vision / AWS Textract)
- [ ] Set up development environment (or Docker)
- [ ] Team members identified for:
  - [ ] Backend development
  - [ ] Frontend development
  - [ ] Integration work
  - [ ] Testing/QA

---

## 🎉 SUCCESS METRICS

Track progress with these metrics:

### Week 1
- [ ] Batch submission working (upload → barcode → watermark → save)
- [ ] 10 test claims processed successfully

### Week 2
- [ ] Maker-checker workflow operational
- [ ] 5 claims approved through full workflow

### Week 3
- [ ] OCR extracting 6 mandatory fields
- [ ] 90%+ accuracy on test documents

### Week 4
- [ ] EDMS integration pushing/pulling documents
- [ ] eOxegen receiving extracted data

### Week 8
- [ ] 100 concurrent users tested
- [ ] 1,000 claims processed in 1 day
- [ ] Security audit passed

---

## 🚀 YOU'RE READY!

**Everything is in place**:
- ✅ Complete database schema
- ✅ All dependencies identified
- ✅ PDF services implemented
- ✅ Clear implementation roadmap
- ✅ Comprehensive documentation

**Next**: Run the install commands and start building!

```bash
# Start your engines!
cd /home/bigdev/Desktop/cic/claims/backend
npm install
npx prisma migrate dev --name init
npm run start:dev
```

---

**Need help?** Check the implementation roadmap, SRD analysis, and status documents for detailed guidance.

**Good luck! 🎯**
