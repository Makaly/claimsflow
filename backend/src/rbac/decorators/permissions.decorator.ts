import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_MODE_KEY = 'permissions_mode';

// Require ALL listed permissions (default).
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// Require AT LEAST ONE of the listed permissions.
export const RequireAnyPermission = (...permissions: string[]) => (
  target: any,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
) => {
  SetMetadata(PERMISSIONS_KEY, permissions)(target, propertyKey as any, descriptor as any);
  SetMetadata(PERMISSIONS_MODE_KEY, 'any')(target, propertyKey as any, descriptor as any);
};
