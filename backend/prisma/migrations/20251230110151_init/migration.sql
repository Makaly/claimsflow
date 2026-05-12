-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requirePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "physicalAddress" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending_approval',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "parentProviderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "canSubmitClaims" BOOLEAN NOT NULL DEFAULT false,
    "maxDailySubmissions" INTEGER DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_submissions" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "submissionMethod" TEXT NOT NULL,
    "totalClaims" INTEGER NOT NULL DEFAULT 0,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "processedClaims" INTEGER NOT NULL DEFAULT 0,
    "failedClaims" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "batch_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "batchNumber" TEXT,
    "folioNumber" TEXT,
    "barcode" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "memberNumber" TEXT,
    "memberName" TEXT,
    "patientName" TEXT,
    "patientId" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceAmount" DOUBLE PRECISION,
    "dateOfService" TIMESTAMP(3),
    "diagnosis" TEXT,
    "treatment" TEXT,
    "procedureCodes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "workflowStage" TEXT NOT NULL DEFAULT 'initial_review',
    "assignedTo" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "isRejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "resubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "originalClaimId" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "missingDocuments" TEXT[],
    "completenessCheckedAt" TIMESTAMP(3),
    "completenessCheckedBy" TEXT,
    "ocrStatus" TEXT NOT NULL DEFAULT 'pending',
    "ocrConfidence" DOUBLE PRECISION,
    "ocrProcessedAt" TIMESTAMP(3),
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT false,
    "batchId" TEXT,
    "assignmentStrategy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_approvals" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "approvalStage" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_status_history" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "path" TEXT NOT NULL,
    "documentType" TEXT,
    "claimId" TEXT,
    "batchNumber" TEXT,
    "folioNumber" TEXT,
    "hasWatermark" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "isConverted" BOOLEAN NOT NULL DEFAULT false,
    "originalFormat" TEXT,
    "conversionStatus" TEXT,
    "ocrText" TEXT,
    "ocrStatus" TEXT NOT NULL DEFAULT 'pending',
    "ocrConfidence" DOUBLE PRECISION,
    "ocrProcessedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentDocumentId" TEXT,
    "isLatestVersion" BOOLEAN NOT NULL DEFAULT true,
    "hasAnnotations" BOOLEAN NOT NULL DEFAULT false,
    "annotationsCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uploadedBy" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_annotations" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "content" TEXT,
    "color" TEXT,
    "signatureData" TEXT,
    "signerName" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "changeDescription" TEXT,
    "filePath" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_extractions" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "memberNumber" TEXT,
    "memberName" TEXT,
    "providerName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceAmount" DOUBLE PRECISION,
    "patientName" TEXT,
    "dateOfService" TIMESTAMP(3),
    "diagnosis" TEXT,
    "procedureCodes" TEXT[],
    "overallConfidence" DOUBLE PRECISION,
    "fieldConfidences" JSONB,
    "ocrEngine" TEXT,
    "ocrEngineVersion" TEXT,
    "templateUsed" TEXT,
    "documentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "anomalyScore" DOUBLE PRECISION,
    "possibleFraud" BOOLEAN NOT NULL DEFAULT false,
    "anomalyReasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ocr_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "documentType" TEXT NOT NULL,
    "providerType" TEXT,
    "specificProvider" TEXT,
    "fieldDefinitions" JSONB NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ocr_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edms_documents" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "edmsDocumentId" TEXT NOT NULL,
    "edmsBarcode" TEXT,
    "edmsIndexKey" TEXT,
    "edmsMetadata" JSONB,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastSyncAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edms_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eoxegen_data" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "memberNumber" TEXT,
    "memberName" TEXT,
    "providerName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceAmount" DOUBLE PRECISION,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "smartClaimId" TEXT,
    "smartClaimNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eoxegen_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "htmlContent" TEXT,
    "templateName" TEXT,
    "templateData" JSONB,
    "claimId" TEXT,
    "providerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subject" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "htmlTemplate" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "parameters" JSONB,
    "filters" JSONB,
    "groupBy" TEXT[],
    "isScheduled" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "recipients" TEXT[],
    "format" TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_executions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "resultPath" TEXT,
    "resultSize" BIGINT,
    "rowCount" INTEGER,
    "error" TEXT,
    "executedBy" TEXT,

    CONSTRAINT "report_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "userRole" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "method" TEXT,
    "endpoint" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'string',
    "description" TEXT,
    "category" TEXT,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_providerId_idx" ON "users"("providerId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "providers_licenseNumber_key" ON "providers"("licenseNumber");

-- CreateIndex
CREATE INDEX "providers_status_idx" ON "providers"("status");

-- CreateIndex
CREATE INDEX "providers_type_idx" ON "providers"("type");

-- CreateIndex
CREATE INDEX "providers_licenseNumber_idx" ON "providers"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "batch_submissions_batchNumber_key" ON "batch_submissions"("batchNumber");

-- CreateIndex
CREATE INDEX "batch_submissions_batchNumber_idx" ON "batch_submissions"("batchNumber");

-- CreateIndex
CREATE INDEX "batch_submissions_providerId_idx" ON "batch_submissions"("providerId");

-- CreateIndex
CREATE INDEX "batch_submissions_status_idx" ON "batch_submissions"("status");

-- CreateIndex
CREATE INDEX "batch_submissions_createdAt_idx" ON "batch_submissions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claimNumber_key" ON "claims"("claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "claims_barcode_key" ON "claims"("barcode");

-- CreateIndex
CREATE INDEX "claims_claimNumber_idx" ON "claims"("claimNumber");

-- CreateIndex
CREATE INDEX "claims_barcode_idx" ON "claims"("barcode");

-- CreateIndex
CREATE INDEX "claims_providerId_idx" ON "claims"("providerId");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claims_workflowStage_idx" ON "claims"("workflowStage");

-- CreateIndex
CREATE INDEX "claims_assignedTo_idx" ON "claims"("assignedTo");

-- CreateIndex
CREATE INDEX "claims_submittedAt_idx" ON "claims"("submittedAt");

-- CreateIndex
CREATE INDEX "claims_memberNumber_idx" ON "claims"("memberNumber");

-- CreateIndex
CREATE INDEX "claim_approvals_claimId_idx" ON "claim_approvals"("claimId");

-- CreateIndex
CREATE INDEX "claim_approvals_approvedBy_idx" ON "claim_approvals"("approvedBy");

-- CreateIndex
CREATE INDEX "claim_status_history_claimId_idx" ON "claim_status_history"("claimId");

-- CreateIndex
CREATE INDEX "claim_status_history_createdAt_idx" ON "claim_status_history"("createdAt");

-- CreateIndex
CREATE INDEX "documents_claimId_idx" ON "documents"("claimId");

-- CreateIndex
CREATE INDEX "documents_batchNumber_idx" ON "documents"("batchNumber");

-- CreateIndex
CREATE INDEX "documents_documentType_idx" ON "documents"("documentType");

-- CreateIndex
CREATE INDEX "documents_ocrStatus_idx" ON "documents"("ocrStatus");

-- CreateIndex
CREATE INDEX "document_annotations_documentId_idx" ON "document_annotations"("documentId");

-- CreateIndex
CREATE INDEX "document_annotations_type_idx" ON "document_annotations"("type");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_extractions_claimId_key" ON "ocr_extractions"("claimId");

-- CreateIndex
CREATE INDEX "ocr_extractions_claimId_idx" ON "ocr_extractions"("claimId");

-- CreateIndex
CREATE INDEX "ocr_extractions_status_idx" ON "ocr_extractions"("status");

-- CreateIndex
CREATE INDEX "ocr_extractions_requiresReview_idx" ON "ocr_extractions"("requiresReview");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_templates_name_key" ON "ocr_templates"("name");

-- CreateIndex
CREATE INDEX "ocr_templates_documentType_idx" ON "ocr_templates"("documentType");

-- CreateIndex
CREATE INDEX "ocr_templates_isActive_idx" ON "ocr_templates"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "edms_documents_claimId_key" ON "edms_documents"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "edms_documents_edmsDocumentId_key" ON "edms_documents"("edmsDocumentId");

-- CreateIndex
CREATE INDEX "edms_documents_claimId_idx" ON "edms_documents"("claimId");

-- CreateIndex
CREATE INDEX "edms_documents_edmsDocumentId_idx" ON "edms_documents"("edmsDocumentId");

-- CreateIndex
CREATE INDEX "edms_documents_syncStatus_idx" ON "edms_documents"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "eoxegen_data_claimId_key" ON "eoxegen_data"("claimId");

-- CreateIndex
CREATE INDEX "eoxegen_data_claimId_idx" ON "eoxegen_data"("claimId");

-- CreateIndex
CREATE INDEX "eoxegen_data_syncStatus_idx" ON "eoxegen_data"("syncStatus");

-- CreateIndex
CREATE INDEX "eoxegen_data_memberNumber_idx" ON "eoxegen_data"("memberNumber");

-- CreateIndex
CREATE INDEX "notifications_recipientId_idx" ON "notifications"("recipientId");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_claimId_idx" ON "notifications"("claimId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_name_key" ON "notification_templates"("name");

-- CreateIndex
CREATE INDEX "notification_templates_eventType_idx" ON "notification_templates"("eventType");

-- CreateIndex
CREATE INDEX "notification_templates_isActive_idx" ON "notification_templates"("isActive");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "reports"("type");

-- CreateIndex
CREATE INDEX "reports_isScheduled_idx" ON "reports"("isScheduled");

-- CreateIndex
CREATE INDEX "report_executions_reportId_idx" ON "report_executions"("reportId");

-- CreateIndex
CREATE INDEX "report_executions_status_idx" ON "report_executions"("status");

-- CreateIndex
CREATE INDEX "report_executions_startedAt_idx" ON "report_executions"("startedAt");

-- CreateIndex
CREATE INDEX "activity_logs_userId_idx" ON "activity_logs"("userId");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs"("entity");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE INDEX "system_config_category_idx" ON "system_config"("category");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_parentProviderId_fkey" FOREIGN KEY ("parentProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_submissions" ADD CONSTRAINT "batch_submissions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_approvals" ADD CONSTRAINT "claim_approvals_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_approvals" ADD CONSTRAINT "claim_approvals_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edms_documents" ADD CONSTRAINT "edms_documents_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
