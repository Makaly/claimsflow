import api from './api'

export interface Permission {
  id: string
  name: string
  resource: string
  action: string
  description?: string | null
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface RolePermission {
  id: string
  roleId: string
  permissionId: string
  permission: Permission
}

export interface Role {
  id: string
  name: string
  displayName?: string | null
  description?: string | null
  isSystem: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  rolePermissions: RolePermission[]
  // Populated by GET /rbac/roles/:id (single-role endpoint)
  userRoles?: Array<{
    id: string
    userId: string
    roleId: string
    assignedAt: string
    assignedBy?: string | null
    user?: { id: string; email: string; name: string }
  }>
  _count?: { userRoles: number }
}

export interface UserRole {
  id: string
  userId: string
  roleId: string
  assignedAt: string
  assignedBy?: string | null
  role: Role
}

export const rbacService = {
  // Permissions
  listPermissions: async (): Promise<Permission[]> => {
    const { data } = await api.get('/rbac/permissions')
    return data
  },
  createPermission: async (body: {
    resource: string
    action: string
    description?: string
  }): Promise<Permission> => {
    const { data } = await api.post('/rbac/permissions', body)
    return data
  },
  deletePermission: async (id: string): Promise<void> => {
    await api.delete(`/rbac/permissions/${id}`)
  },

  // Roles
  listRoles: async (): Promise<Role[]> => {
    const { data } = await api.get('/rbac/roles')
    return data
  },
  getRole: async (id: string): Promise<Role> => {
    const { data } = await api.get(`/rbac/roles/${id}`)
    return data
  },
  createRole: async (body: {
    name: string
    displayName?: string
    description?: string
    permissions?: string[]
  }): Promise<Role> => {
    const { data } = await api.post('/rbac/roles', body)
    return data
  },
  updateRole: async (
    id: string,
    body: {
      displayName?: string
      description?: string
      isActive?: boolean
      permissions?: string[]
    },
  ): Promise<Role> => {
    const { data } = await api.put(`/rbac/roles/${id}`, body)
    return data
  },
  deleteRole: async (id: string): Promise<void> => {
    await api.delete(`/rbac/roles/${id}`)
  },
  setRolePermissions: async (id: string, permissions: string[]): Promise<void> => {
    await api.put(`/rbac/roles/${id}/permissions`, { permissions })
  },

  // User ↔ Role
  listUserRoles: async (userId: string): Promise<UserRole[]> => {
    const { data } = await api.get(`/rbac/users/${userId}/roles`)
    return data
  },
  assignRole: async (userId: string, roleName: string): Promise<UserRole[]> => {
    const { data } = await api.post(`/rbac/users/${userId}/roles/${roleName}`)
    return data
  },
  revokeRole: async (userId: string, roleName: string): Promise<UserRole[]> => {
    const { data } = await api.delete(`/rbac/users/${userId}/roles/${roleName}`)
    return data
  },
  setPrimaryRole: async (userId: string, roleName: string): Promise<UserRole[]> => {
    const { data } = await api.patch(`/rbac/users/${userId}/primary-role`, { roleName })
    return data
  },

  // Current user
  myPermissions: async (): Promise<{ userId: string; permissions: string[] }> => {
    const { data } = await api.get('/rbac/me/permissions')
    return data
  },
}
