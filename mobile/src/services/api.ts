/**
 * Axios instance for ClaimsFlow mobile app.
 * Base URL is read from app.json extra.apiBaseUrl at build time via Constants.
 * TODO(prod): wire Expo Constants import when ejecting from bare workflow.
 */
import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://api.claimsflow.cic.co.ke/api';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// Attach the JWT access token on every request.
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear stored credentials and let the navigator handle redirect.
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    if (err.response?.status === 401) {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
      // TODO(nav): emit a global event that RootNavigator listens to for
      // redirecting to LoginScreen without a direct import here.
    }
    return Promise.reject(err);
  },
);

export default api;
