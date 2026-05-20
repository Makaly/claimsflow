/**
 * LoginScreen — email/password sign-in with a two-factor (OTP) step.
 * On success it calls notifyAuthChanged() so RootNavigator swaps to the
 * authenticated tab navigator.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { login, verifyOtp } from '../services/auth';
import { notifyAuthChanged } from '../services/session';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needsOtp, setNeedsOtp] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const res = await login({ email: email.trim(), password });
      if (res.requiresTwoFactor) {
        setNeedsOtp(true);
      } else {
        notifyAuthChanged();
      }
    } catch {
      Alert.alert('Login failed', 'Check your credentials and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.trim().length < 4) {
      Alert.alert('Invalid code', 'Enter the verification code sent to you.');
      return;
    }
    setBusy(true);
    try {
      await verifyOtp({ email: email.trim(), otp: otp.trim() });
      notifyAuthChanged();
    } catch {
      Alert.alert('Verification failed', 'The code is incorrect or expired.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.brand}>ClaimsFlow</Text>
      <Text style={styles.subtitle}>CIC Insurance Group</Text>

      {!needsOtp ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9ca3af"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.otpHint}>
            Enter the verification code sent to {email}.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Verification code"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
          />
          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleVerifyOtp}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#1e3a5f',
  },
  brand: {
    fontSize: 34,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#cbd5e1',
    textAlign: 'center',
    marginBottom: 36,
  },
  otpHint: {
    fontSize: 14,
    color: '#cbd5e1',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    marginBottom: 14,
  },
  button: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
