-- CreateTable
CREATE TABLE "claim_labels" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "labelledBy" TEXT,
    "notes" TEXT,
    "featuresSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claim_labels_claimId_key" ON "claim_labels"("claimId");

-- CreateIndex
CREATE INDEX "claim_labels_label_idx" ON "claim_labels"("label");

-- CreateIndex
CREATE INDEX "claim_labels_source_idx" ON "claim_labels"("source");

-- CreateIndex
CREATE INDEX "claim_labels_createdAt_idx" ON "claim_labels"("createdAt");
