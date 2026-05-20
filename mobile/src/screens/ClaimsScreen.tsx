/**
 * ClaimsScreen — scrollable list of the member's claims with a button to
 * start a new submission. Tapping a row opens ClaimDetailScreen.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listClaims, Claim } from '../services/claims';
import type { ClaimsStackParamList } from '../navigation/MainTabs';

type ClaimsNav = NativeStackNavigationProp<ClaimsStackParamList, 'ClaimsList'>;

const STATUS_COLOR: Record<string, string> = {
  submitted: '#d97706',
  processing: '#d97706',
  under_review: '#d97706',
  approved: '#15803d',
  paid: '#15803d',
  rejected: '#b91c1c',
};

export default function ClaimsScreen() {
  const navigation = useNavigation<ClaimsNav>();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setClaims(await listClaims());
    } catch {
      setError('Could not load your claims. Pull down to retry.');
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={claims}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          claims.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {error ?? 'You have no claims yet. Tap "New Claim" to start.'}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              navigation.navigate('ClaimDetail', { claimId: item.id })
            }
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>
                {item.claimNumber ?? `Claim ${item.id.slice(0, 8)}`}
              </Text>
              <Text style={styles.rowSub}>
                {item.providerName ?? 'Unknown provider'}
              </Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={styles.amount}>
                {item.invoiceAmount != null
                  ? `KES ${item.invoiceAmount.toLocaleString()}`
                  : '—'}
              </Text>
              <Text
                style={[
                  styles.status,
                  { color: STATUS_COLOR[item.status] ?? '#6b7280' },
                ]}
              >
                {item.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('NewClaim')}
      >
        <Text style={styles.fabText}>+ New Claim</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  listContent: {
    padding: 16,
    paddingBottom: 90,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  empty: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowSub: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  rowEnd: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 28,
  },
  fabText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
