/**
 * Bottom-tab navigator for authenticated users.
 * TODO(prod): add badge counts on Claims tab from socket.io events.
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ClaimsScreen from '../screens/ClaimsScreen';
import ClaimDetailScreen from '../screens/ClaimDetailScreen';
import NewClaimScreen from '../screens/NewClaimScreen';
import ECardScreen from '../screens/ECardScreen';
import ProfileScreen from '../screens/ProfileScreen';

export type MainTabParamList = {
  HomeTab: undefined;
  ClaimsTab: undefined;
  ECard: undefined;
  Profile: undefined;
};

export type ClaimsStackParamList = {
  ClaimsList: undefined;
  ClaimDetail: { claimId: string };
  NewClaim: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const ClaimsStack = createNativeStackNavigator<ClaimsStackParamList>();

function ClaimsNavigator() {
  return (
    <ClaimsStack.Navigator>
      <ClaimsStack.Screen name="ClaimsList" component={ClaimsScreen} options={{ title: 'My Claims' }} />
      <ClaimsStack.Screen name="ClaimDetail" component={ClaimDetailScreen} options={{ title: 'Claim Detail' }} />
      <ClaimsStack.Screen name="NewClaim" component={NewClaimScreen} options={{ title: 'New Claim' }} />
    </ClaimsStack.Navigator>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#1e3a5f',
        tabBarInactiveTintColor: '#9ca3af',
        headerShown: false,
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="ClaimsTab" component={ClaimsNavigator} options={{ title: 'Claims' }} />
      <Tab.Screen name="ECard" component={ECardScreen} options={{ title: 'E-Card' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
