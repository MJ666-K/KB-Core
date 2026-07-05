import type { Permission } from './permission-registry';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  roleLabel: string;
  permissions: Permission[];
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: string;
  type: 'access';
  jti: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    role: string;
    roleLabel: string;
    permissions: Permission[];
  };
}
