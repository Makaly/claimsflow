/**
 * ProfileScreen — shows the authenticated user's account details and a
 * sign-out action. Logout clears credentials and signals RootNavigator.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getProfile, logout, AuthUser } from '../services/auth';
import { notifyAuthChanged } from '../services/session';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    getProfile()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
      notifyAuthChanged();
    }
  }

  function confirmLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: handleLogout },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name ?? '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name ?? 'Unknown user'}</Text>
        <Text style={styles.email}>{user?.email ?? ''}</Text>
      </View>

      <View style={styles.infoCard}>
        <Row label="Role" value={user?.role ?? '—'} />
        <Row label="Account ID" value={user?.id ?? '—'} />
        {user?.providerId ? (
          <Row label="Provider ID" value={user.providerId} />
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.logoutButton, signingOut && styles.buttonDisabled]}
        onPress={confirmLogout}
        disabled={signingOut}
      >
        {signingOut ? (
          <ActivityIndicator color="#b91c1c" />
        ) : (
          <Text style={styles.logoutText}>Sign Out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1e3a5f',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
  },
  name: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111827',
  },
  email: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  rowValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  logoutButton: {
    marginTop: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b91c1c',
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  logoutText: {
    color: '#b91c1c',
    fontSize: 15,
    fontWeight: '600',
  },
});
