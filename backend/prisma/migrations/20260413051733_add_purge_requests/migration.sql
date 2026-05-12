-- CreateTable
CREATE TABLE "purge_requests" (
    "id" TEXT NOT NULL,
    "mergedDocumentId" TEXT,
    "sourceDocumentIds" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "executedAt" TIMESTAMP(3),
    "purgedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purge_requests_status_idx" ON "purge_requests"("status");

-- CreateIndex
CREATE INDEX "purge_requests_requestedBy_idx" ON "purge_requests"("requestedBy");
