/**
 * Axios instance for ClaimsFlow mobile app.
 * Base URL is read from app.json extra.apiBaseUrl at build time via Constants.
 * TODO(prod): wire Expo Constants import when ejecting from bare workflow.
 */
import axios, { AxiosError } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../../app.json');

const BASE_URL = 'https://api.claimsflow.cic.co.ke/api';

// Upload-source headers — the backend records these on each batch/claim so
// reviewers can tell which channel (android/ios) and build produced it. Mirrors
// the web portal (X-Client-Platform: web) and the KMP app's Ktor DefaultRequest.
const CLIENT_PLATFORM = Platform.OS; // 'android' | 'ios'
const APP_VERSION: string = appJson?.expo?.version ?? '0.1.0';
const DEVICE_INFO = `${Platform.OS}; ${Platform.Version}`;

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// Attach the JWT access token + upload-source metadata on every request.
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['X-Client-Platform'] = CLIENT_PLATFORM;
  config.headers['X-App-Version'] = APP_VERSION;
  config.headers['X-Device-Info'] = DEVICE_INFO;
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
