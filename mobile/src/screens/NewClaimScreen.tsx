/**
 * NewClaimScreen — form for submitting a new claim. On success it returns
 * to the claims list, which re-fetches on focus.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createClaim } from '../services/claims';
import type { ClaimsStackParamList } from '../navigation/MainTabs';

type NewClaimNav = NativeStackNavigationProp<ClaimsStackParamList, 'NewClaim'>;

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export default function NewClaimScreen() {
  const navigation = useNavigation<NewClaimNav>();
  const [providerName, setProviderName] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const invoiceAmount = Number(amount);
    if (!providerName.trim() || !memberNumber.trim()) {
      Alert.alert('Missing details', 'Provider and member number are required.');
      return;
    }
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid invoice amount.');
      return;
    }
    setSubmitting(true);
    try {
      await createClaim({
        providerName: providerName.trim(),
        memberNumber: memberNumber.trim(),
        invoiceAmount,
        diagnosis: diagnosis.trim() || undefined,
      });
      Alert.alert('Claim submitted', 'Your claim has been received.');
      navigation.goBack();
    } catch {
      Alert.alert('Submission failed', 'Could not submit the claim. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Labelled label="Provider name">
        <TextInput
          style={styles.input}
          value={providerName}
          onChangeText={setProviderName}
          placeholder="e.g. Aga Khan Hospital"
          placeholderTextColor="#9ca3af"
        />
      </Labelled>

      <Labelled label="Member number">
        <TextInput
          style={styles.input}
          value={memberNumber}
          onChangeText={setMemberNumber}
          autoCapitalize="characters"
          placeholder="MEM-000000"
          placeholderTextColor="#9ca3af"
        />
      </Labelled>

      <Labelled label="Invoice amount (KES)">
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#9ca3af"
        />
      </Labelled>

      <Labelled label="Diagnosis (optional)">
        <TextInput
          style={[styles.input, styles.multiline]}
          value={diagnosis}
          onChangeText={setDiagnosis}
          multiline
          placeholder="Reason for the claim"
          placeholderTextColor="#9ca3af"
        />
      </Labelled>

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Submit Claim</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f3f4f6',
    flexGrow: 1,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#1e3a5f',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
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
