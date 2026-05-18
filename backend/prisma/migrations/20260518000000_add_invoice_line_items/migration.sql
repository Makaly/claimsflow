-- CreateTable: invoice_line_items
-- Each row is one billed service extracted from an invoice via OCR / vision AI.

CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "lineNumber" INTEGER,
    "description" TEXT NOT NULL,
    "itemName" TEXT,
    "category" TEXT,
    "quantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "totalPrice" DOUBLE PRECISION,
    "taxAmount" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "serviceDate" TEXT,
    "procedureCode" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "layoutConfidence" DOUBLE PRECISION,
    "semanticConfidence" DOUBLE PRECISION,
    "overallConfidence" DOUBLE PRECISION,
    "fraudRisk" TEXT,
    "fraudRiskScore" DOUBLE PRECISION,
    "fraudFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "arithmeticValid" BOOLEAN,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "invoice_line_items_claimId_idx" ON "invoice_line_items"("claimId");
CREATE INDEX "invoice_line_items_fraudRisk_idx" ON "invoice_line_items"("fraudRisk");
