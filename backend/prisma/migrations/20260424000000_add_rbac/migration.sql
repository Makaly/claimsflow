-- CreateTable: roles
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE INDEX "roles_name_idx" ON "roles"("name");

-- CreateTable: permissions (ACL entries)
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");
CREATE INDEX "permissions_action_idx" ON "permissions"("action");

-- CreateTable: role_permissions (role ↔ permission join)
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");
CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: user_roles (user ↔ role join)
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
