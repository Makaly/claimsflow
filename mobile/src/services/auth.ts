/**
 * Auth service — handles login, logout, and 2FA challenge.
 *
 * TODO(prod): replace SMS OTP stub with the real /auth/2fa/verify endpoint.
 * TODO(prod): implement refresh-token rotation using /auth/refresh.
 * TODO(prod): add biometric unlock (expo-local-authentication) as a second
 *             factor after the initial password login to avoid re-entering
 *             credentials on app resume.
 */
import * as SecureStore from 'expo-secure-store';
import api from './api';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface OtpPayload {
  email: string;
  otp: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  providerId?: string;
}

export interface LoginResponse {
  requiresTwoFactor: boolean;
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
}

/** Step 1: submit credentials. May return a 2FA challenge. */
export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', payload);

  if (!data.requiresTwoFactor && data.accessToken) {
    await SecureStore.setItemAsync('access_token', data.accessToken);
    if (data.refreshToken) {
      await SecureStore.setItemAsync('refresh_token', data.refreshToken);
    }
  }

  return data;
}

/**
 * Step 2: submit TOTP / SMS OTP.
 *
 * TODO(prod): POST /auth/2fa/verify — backend currently returns the token in
 *             the same shape as login. Confirm endpoint when backend is wired.
 */
export async function verifyOtp(payload: OtpPayload): Promise<LoginResponse> {
  // STUB: mirrors the expected API shape; real endpoint not yet wired.
  const { data } = await api.post<LoginResponse>('/auth/2fa/verify', payload);

  if (data.accessToken) {
    await SecureStore.setItemAsync('access_token', data.accessToken);
    if (data.refreshToken) {
      await SecureStore.setItemAsync('refresh_token', data.refreshToken);
    }
  }

  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
  }
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync('access_token');
}
