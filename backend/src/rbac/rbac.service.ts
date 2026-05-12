import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from './constants/permissions';
import { DEFAULT_ROLES } from './constants/roles';

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.seedDefaults();
    } catch (err: any) {
      // If the tables don't exist yet (migration not run), don't crash boot.
      this.logger.warn(
        `RBAC seed skipped: ${err?.message ?? err}. Run prisma migrate deploy.`,
      );
    }
  }

  // ------------------------------------------------------------
  // Seeding
  // ------------------------------------------------------------

  async seedDefaults() {
    // Upsert every canonical permission.
    for (const def of PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { name: def.name },
        create: {
          name: def.name,
          resource: def.resource,
          action: def.action,
          description: def.description,
          isSystem: true,
        },
        update: {
          resource: def.resource,
          action: def.action,
          description: def.description,
          isSystem: true,
        },
      });
    }

    // Upsert default roles and align their permission grants.
    for (const roleDef of DEFAULT_ROLES) {
      const role = await this.prisma.role.upsert({
        where: { name: roleDef.name },
        create: {
          name: roleDef.name,
          displayName: roleDef.displayName,
          description: roleDef.description,
          isSystem: true,
          isActive: true,
        },
        update: {
          displayName: roleDef.displayName,
          description: roleDef.description,
          isSystem: true,
        },
      });

      const perms = await this.prisma.permission.findMany({
        where: { name: { in: roleDef.permissions } },
        select: { id: true, name: true },
      });

      // Add missing grants. We do NOT revoke extra grants so admins can
      // customise roles without the seeder fighting them.
      for (const perm of perms) {
        await this.prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: role.id, permissionId: perm.id },
          },
          create: { roleId: role.id, permissionId: perm.id },
          update: {},
        });
      }
    }

    // For every user that has a legacy string role but no UserRole rows yet,
    // assign the matching role so authz keeps working after migration.
    const users = await this.prisma.user.findMany({
      select: { id: true, role: true },
    });
    for (const u of users) {
      if (!u.role) continue;
      const role = await this.prisma.role.findUnique({ where: { name: u.role } });
      if (!role) continue;
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: u.id, roleId: role.id } },
        create: { userId: u.id, roleId: role.id },
        update: {},
      });
    }
  }

  // ------------------------------------------------------------
  // Permissions
  // ------------------------------------------------------------

  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async createPermission(data: {
    resource: string;
    action: string;
    description?: string;
  }) {
    const name = `${data.resource}.${data.action}`;
    const existing = await this.prisma.permission.findUnique({ where: { name } });
    if (existing) throw new ConflictException(`Permission ${name} already exists`);
    return this.prisma.permission.create({
      data: {
        name,
        resource: data.resource,
        action: data.action,
        description: data.description,
        isSystem: false,
      },
    });
  }

  async deletePermission(id: string) {
    const perm = await this.prisma.permission.findUnique({ where: { id } });
    if (!perm) throw new NotFoundException('Permission not found');
    if (perm.isSystem) {
      throw new ForbiddenException('System permissions cannot be deleted');
    }
    return this.prisma.permission.delete({ where: { id } });
  }

  // ------------------------------------------------------------
  // Roles
  // ------------------------------------------------------------

  listRoles() {
    return this.prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
        userRoles: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(
    data: { name: string; displayName?: string; description?: string; permissions?: string[] },
    actorId?: string,
  ) {
    const existing = await this.prisma.role.findUnique({ where: { name: data.name } });
    if (existing) throw new ConflictException(`Role ${data.name} already exists`);

    const role = await this.prisma.role.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        isSystem: false,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    if (data.permissions?.length) {
      await this.setRolePermissions(role.id, data.permissions, actorId);
    }
    return this.getRole(role.id);
  }

  async updateRole(
    id: string,
    data: { displayName?: string; description?: string; isActive?: boolean; permissions?: string[] },
    actorId?: string,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    await this.prisma.role.update({
      where: { id },
      data: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        updatedBy: actorId,
      },
    });

    if (data.permissions) {
      await this.setRolePermissions(id, data.permissions, actorId);
    }
    return this.getRole(id);
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    return this.prisma.role.delete({ where: { id } });
  }

  // Replace the role's permission set with the given list of permission names.
  async setRolePermissions(roleId: string, permissionNames: string[], actorId?: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const perms = await this.prisma.permission.findMany({
      where: { name: { in: permissionNames } },
      select: { id: true, name: true },
    });
    const found = new Set(perms.map((p) => p.name));
    const missing = permissionNames.filter((n) => !found.has(n));
    if (missing.length) {
      throw new BadRequestException(`Unknown permissions: ${missing.join(', ')}`);
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: perms.map((p) => ({
          roleId,
          permissionId: p.id,
          grantedBy: actorId,
        })),
      }),
    ]);
  }

  async grantPermission(roleId: string, permissionName: string, actorId?: string) {
    const perm = await this.prisma.permission.findUnique({
      where: { name: permissionName },
    });
    if (!perm) throw new NotFoundException(`Permission ${permissionName} not found`);
    return this.prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId: perm.id },
      },
      create: { roleId, permissionId: perm.id, grantedBy: actorId },
      update: {},
    });
  }

  async revokePermission(roleId: string, permissionName: string) {
    const perm = await this.prisma.permission.findUnique({
      where: { name: permissionName },
    });
    if (!perm) throw new NotFoundException(`Permission ${permissionName} not found`);
    return this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId: perm.id },
    });
  }

  // ------------------------------------------------------------
  // User ↔ Role assignments
  // ------------------------------------------------------------

  async listUserRoles(userId: string) {
    return this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
  }

  async assignRoleToUser(userId: string, roleName: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new NotFoundException(`Role ${roleName} not found`);

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id, assignedBy: actorId },
      update: {},
    });

    // Keep the legacy string column in sync with the user's "primary" role.
    // First assignment wins — changing primary role goes through setPrimaryRole.
    if (!user.role || user.role === 'user') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: role.name, updatedBy: actorId },
      });
    }
    return this.listUserRoles(userId);
  }

  async revokeRoleFromUser(userId: string, roleName: string) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new NotFoundException(`Role ${roleName} not found`);
    await this.prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
    return this.listUserRoles(userId);
  }

  async setPrimaryRole(userId: string, roleName: string, actorId?: string) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new NotFoundException(`Role ${roleName} not found`);
    // Make sure the user holds this role.
    await this.assignRoleToUser(userId, roleName, actorId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: role.name, updatedBy: actorId },
    });
    return this.listUserRoles(userId);
  }

  // ------------------------------------------------------------
  // Authorization queries
  // ------------------------------------------------------------

  // Resolve the full flattened permission set for a user. Pulls from every role
  // the user holds (via UserRole) plus the legacy string role as a fallback so
  // code paths that still rely on User.role keep working.
  async getUserPermissions(userId: string): Promise<string[]> {
    const [userRoles, user] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId },
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
    ]);

    const perms = new Set<string>();
    for (const ur of userRoles) {
      if (!ur.role.isActive) continue;
      for (const rp of ur.role.rolePermissions) perms.add(rp.permission.name);
    }

    // Fallback: legacy string role that hasn't been migrated yet.
    if (userRoles.length === 0 && user?.role) {
      const legacy = await this.prisma.role.findUnique({
        where: { name: user.role },
        include: { rolePermissions: { include: { permission: true } } },
      });
      if (legacy) {
        for (const rp of legacy.rolePermissions) perms.add(rp.permission.name);
      }
    }

    return Array.from(perms).sort();
  }

  async userHasPermission(userId: string, permissionName: string) {
    const perms = await this.getUserPermissions(userId);
    return perms.includes(permissionName);
  }
}
