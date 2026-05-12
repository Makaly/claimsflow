-- AlterTable: add sample file columns to OcrTemplate
ALTER TABLE "ocr_templates" ADD COLUMN "sampleFilePath" TEXT;
ALTER TABLE "ocr_templates" ADD COLUMN "sampleFileName" TEXT;

-- CreateTable
CREATE TABLE "document_zones" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "description" TEXT,
    "xPercent" DOUBLE PRECISION NOT NULL,
    "yPercent" DOUBLE PRECISION NOT NULL,
    "widthPercent" DOUBLE PRECISION NOT NULL,
    "heightPercent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_zones_templateId_idx" ON "document_zones"("templateId");

-- AddForeignKey
ALTER TABLE "document_zones" ADD CONSTRAINT "document_zones_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ocr_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
