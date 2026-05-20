/**
 * ECardScreen — digital membership card for the authenticated member.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getProfile, AuthUser } from '../services/auth';

export default function ECardScreen() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then(setUser)
      .catch(() => setError('Could not load your membership card.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  if (error || !user) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'No membership data.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.brand}>ClaimsFlow</Text>
        <Text style={styles.cardType}>Member E-Card</Text>
        <Text style={styles.name}>{user.name}</Text>

        <View style={styles.cardRow}>
          <View>
            <Text style={styles.cardLabel}>Member ID</Text>
            <Text style={styles.cardValue}>
              {user.id.slice(0, 12).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.cardLabel}>Plan</Text>
            <Text style={styles.cardValue}>{user.role}</Text>
          </View>
        </View>

        <Text style={styles.email}>{user.email}</Text>
      </View>

      <Text style={styles.note}>
        Present this card at any CIC-accredited facility.
      </Text>
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
  error: {
    fontSize: 14,
    color: '#b91c1c',
  },
  screen: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#1e3a5f',
    borderRadius: 18,
    padding: 24,
  },
  brand: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  cardType: {
    fontSize: 12,
    color: '#cbd5e1',
    marginBottom: 28,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 22,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  cardLabel: {
    fontSize: 11,
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  cardValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 2,
  },
  email: {
    fontSize: 13,
    color: '#cbd5e1',
  },
  note: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 16,
  },
});
