/**
 * ClaimDetailScreen — full detail for a single claim, including the
 * extracted invoice line items when available.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  getClaim,
  getClaimLineItems,
  Claim,
  LineItem,
} from '../services/claims';
import type { ClaimsStackParamList } from '../navigation/MainTabs';

type Props = NativeStackScreenProps<ClaimsStackParamList, 'ClaimDetail'>;

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value ?? '—'}</Text>
    </View>
  );
}

export default function ClaimDetailScreen({ route }: Props) {
  const { claimId } = route.params;
  const [claim, setClaim] = useState<Claim | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [detail, items] = await Promise.all([
        getClaim(claimId),
        getClaimLineItems(claimId).catch(() => [] as LineItem[]),
      ]);
      setClaim(detail);
      setLineItems(items);
    } catch {
      setError('Could not load this claim.');
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  if (error || !claim) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Claim not found.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>
        {claim.claimNumber ?? `Claim ${claim.id.slice(0, 8)}`}
      </Text>
      <Text style={styles.status}>{claim.status.replace(/_/g, ' ')}</Text>

      <View style={styles.section}>
        <Field label="Provider" value={claim.providerName} />
        <Field label="Member number" value={claim.memberNumber} />
        <Field label="Diagnosis" value={claim.diagnosis} />
        <Field
          label="Invoice amount"
          value={
            claim.invoiceAmount != null
              ? `KES ${claim.invoiceAmount.toLocaleString()}`
              : null
          }
        />
        <Field label="Date of service" value={formatDate(claim.dateOfService)} />
        <Field
          label="Submitted"
          value={formatDate(claim.submittedAt ?? claim.createdAt)}
        />
      </View>

      {lineItems.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line items</Text>
          {lineItems.map((item, index) => (
            <View key={index} style={styles.lineItem}>
              <Text style={styles.lineDesc}>{item.description}</Text>
              <Text style={styles.lineAmount}>
                {item.totalPrice != null
                  ? `KES ${item.totalPrice.toLocaleString()}`
                  : '—'}
              </Text>
            </View>
          ))}
        </View>
      )}
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
  error: {
    fontSize: 14,
    color: '#b91c1c',
  },
  container: {
    padding: 20,
    backgroundColor: '#f3f4f6',
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  status: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d97706',
    textTransform: 'capitalize',
    marginBottom: 18,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  fieldLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  fieldValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  lineDesc: {
    fontSize: 13,
    color: '#374151',
    flexShrink: 1,
    marginRight: 12,
  },
  lineAmount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
});
