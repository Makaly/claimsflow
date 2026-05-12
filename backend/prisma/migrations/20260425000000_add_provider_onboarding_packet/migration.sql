-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "onboardingSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "programOfWorksText" TEXT,
ADD COLUMN     "scopeUnderstanding" TEXT,
ADD COLUMN     "yearsProvidingServices" INTEGER;

-- CreateTable
CREATE TABLE "provider_onboarding_documents" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,

    CONSTRAINT "provider_onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_references" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "servicesProvided" TEXT NOT NULL,
    "engagementStartDate" TIMESTAMP(3) NOT NULL,
    "engagementEndDate" TIMESTAMP(3),
    "referenceLetterPath" TEXT,
    "referenceLetterName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_onboarding_documents_providerId_idx" ON "provider_onboarding_documents"("providerId");

-- CreateIndex
CREATE INDEX "provider_onboarding_documents_providerId_category_idx" ON "provider_onboarding_documents"("providerId", "category");

-- CreateIndex
CREATE INDEX "provider_references_providerId_idx" ON "provider_references"("providerId");

-- AddForeignKey
ALTER TABLE "provider_onboarding_documents" ADD CONSTRAINT "provider_onboarding_documents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_references" ADD CONSTRAINT "provider_references_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

