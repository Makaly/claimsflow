-- CreateTable
CREATE TABLE "provider_assignment_rules" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "makerCheckerId" TEXT,
    "claimsOfficerId" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_assignment_rules_providerId_key" ON "provider_assignment_rules"("providerId");

-- CreateIndex
CREATE INDEX "provider_assignment_rules_makerCheckerId_idx" ON "provider_assignment_rules"("makerCheckerId");

-- CreateIndex
CREATE INDEX "provider_assignment_rules_claimsOfficerId_idx" ON "provider_assignment_rules"("claimsOfficerId");

-- AddForeignKey
ALTER TABLE "provider_assignment_rules" ADD CONSTRAINT "provider_assignment_rules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_assignment_rules" ADD CONSTRAINT "provider_assignment_rules_makerCheckerId_fkey" FOREIGN KEY ("makerCheckerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_assignment_rules" ADD CONSTRAINT "provider_assignment_rules_claimsOfficerId_fkey" FOREIGN KEY ("claimsOfficerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

