/**
 * HomeScreen — dashboard summarising the member's claims at a glance.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listClaims, Claim } from '../services/claims';

interface Stat {
  label: string;
  value: number;
  color: string;
}

const IN_PROGRESS = ['submitted', 'processing', 'under_review'];

export default function HomeScreen() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setClaims(await listClaims());
    } catch {
      setClaims([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const countBy = (predicate: (claim: Claim) => boolean) =>
    claims.filter(predicate).length;

  const stats: Stat[] = [
    { label: 'Total claims', value: claims.length, color: '#1e3a5f' },
    {
      label: 'In progress',
      value: countBy((c) => IN_PROGRESS.includes(c.status)),
      color: '#d97706',
    },
    {
      label: 'Approved',
      value: countBy((c) => c.status === 'approved' || c.status === 'paid'),
      color: '#15803d',
    },
    {
      label: 'Rejected',
      value: countBy((c) => c.status === 'rejected'),
      color: '#b91c1c',
    },
  ];

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.greeting}>Welcome back</Text>
      <Text style={styles.subtitle}>Here is your claims summary.</Text>

      <View style={styles.grid}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.card}>
            <Text style={[styles.cardValue, { color: stat.color }]}>
              {stat.value}
            </Text>
            <Text style={styles.cardLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.hint}>
        Pull down to refresh. Use the Claims tab to submit a new claim.
      </Text>
    </ScrollView>
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
    padding: 20,
    backgroundColor: '#f3f4f6',
    flexGrow: 1,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  cardValue: {
    fontSize: 30,
    fontWeight: '700',
  },
  cardLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 10,
    textAlign: 'center',
  },
});
