import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RequirePermissions } from './decorators/permissions.decorator';
import { RbacService } from './rbac.service';

@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RbacController {
  constructor(private rbac: RbacService) {}

  // -------- Permissions (ACL catalogue) --------

  @Get('permissions')
  @RequirePermissions('permissions.read')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Post('permissions')
  @RequirePermissions('permissions.create')
  createPermission(
    @Body() body: { resource: string; action: string; description?: string },
  ) {
    return this.rbac.createPermission(body);
  }

  @Delete('permissions/:id')
  @RequirePermissions('permissions.delete')
  deletePermission(@Param('id') id: string) {
    return this.rbac.deletePermission(id);
  }

  // -------- Roles --------

  @Get('roles')
  @RequirePermissions('roles.read')
  listRoles() {
    return this.rbac.listRoles();
  }

  @Get('roles/:id')
  @RequirePermissions('roles.read')
  getRole(@Param('id') id: string) {
    return this.rbac.getRole(id);
  }

  @Post('roles')
  @RequirePermissions('roles.create')
  createRole(
    @Req() req: any,
    @Body() body: {
      name: string;
      displayName?: string;
      description?: string;
      permissions?: string[];
    },
  ) {
    return this.rbac.createRole(body, req.user?.userId);
  }

  @Put('roles/:id')
  @RequirePermissions('roles.update')
  updateRole(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: {
      displayName?: string;
      description?: string;
      isActive?: boolean;
      permissions?: string[];
    },
  ) {
    return this.rbac.updateRole(id, body, req.user?.userId);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.delete')
  deleteRole(@Param('id') id: string) {
    return this.rbac.deleteRole(id);
  }

  // Grant/revoke a single permission on a role (without replacing the whole set).
  @Post('roles/:id/permissions/:permissionName')
  @RequirePermissions('roles.update')
  grantPermission(
    @Param('id') id: string,
    @Param('permissionName') permissionName: string,
    @Req() req: any,
  ) {
    return this.rbac.grantPermission(id, permissionName, req.user?.userId);
  }

  @Delete('roles/:id/permissions/:permissionName')
  @RequirePermissions('roles.update')
  revokePermission(
    @Param('id') id: string,
    @Param('permissionName') permissionName: string,
  ) {
    return this.rbac.revokePermission(id, permissionName);
  }

  // Replace the role's entire permission set in one call.
  @Put('roles/:id/permissions')
  @RequirePermissions('roles.update')
  setRolePermissions(
    @Param('id') id: string,
    @Body() body: { permissions: string[] },
    @Req() req: any,
  ) {
    return this.rbac.setRolePermissions(id, body.permissions, req.user?.userId);
  }

  // -------- User ↔ Role assignments --------

  @Get('users/:userId/roles')
  @RequirePermissions('roles.read')
  listUserRoles(@Param('userId') userId: string) {
    return this.rbac.listUserRoles(userId);
  }

  @Post('users/:userId/roles/:roleName')
  @RequirePermissions('roles.assign')
  assignRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
    @Req() req: any,
  ) {
    return this.rbac.assignRoleToUser(userId, roleName, req.user?.userId);
  }

  @Delete('users/:userId/roles/:roleName')
  @RequirePermissions('roles.assign')
  revokeRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
  ) {
    return this.rbac.revokeRoleFromUser(userId, roleName);
  }

  @Patch('users/:userId/primary-role')
  @RequirePermissions('roles.assign')
  setPrimaryRole(
    @Param('userId') userId: string,
    @Body() body: { roleName: string },
    @Req() req: any,
  ) {
    return this.rbac.setPrimaryRole(userId, body.roleName, req.user?.userId);
  }

  // Current user's effective permissions — useful for frontends to hide/show UI.
  @Get('me/permissions')
  async myPermissions(@Req() req: any) {
    return {
      userId: req.user?.userId,
      permissions: await this.rbac.getUserPermissions(req.user?.userId),
    };
  }
}
