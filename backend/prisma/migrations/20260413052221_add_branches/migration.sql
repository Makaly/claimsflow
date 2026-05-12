-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "region" TEXT,
    "county" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contactPerson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE INDEX "branches_providerId_idx" ON "branches"("providerId");

-- CreateIndex
CREATE INDEX "branches_isActive_idx" ON "branches"("isActive");

-- CreateIndex
CREATE INDEX "branches_isApproved_idx" ON "branches"("isApproved");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
