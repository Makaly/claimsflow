/**
 * Root navigator — switches between Auth stack and the main tab navigator
 * based on whether a valid token exists in SecureStore.
 *
 * It re-evaluates the stored token whenever `notifyAuthChanged()` fires
 * (after login/logout), so screens never need to import the navigator.
 */
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { getStoredToken } from '../services/auth';
import { onAuthChanged } from '../services/session';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const [checking, setChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      getStoredToken()
        .then((t) => setIsAuthed(!!t))
        .finally(() => setChecking(false));
    };
    evaluate();
    return onAuthChanged(evaluate);
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthed ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
