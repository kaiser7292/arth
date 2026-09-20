import React, { useState, useEffect } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Card, ScreenContainer, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/hooks/use-alert';
import { logger } from '@/utils/logger';
import {
  getZebpayCredentials,
  startZebpayConnect,
  completeZebpayConnect,
  clearZebpayCredentials,
} from '@/services/zebpay-connect';

function Field({
  label, value, onChange, placeholder, hint, secure, keyboardType, colors,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; hint?: string; secure?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
  colors: ReturnType<typeof useColorScheme>['colors'];
}) {
  return (
    <View className="mb-4">
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType ?? 'default'}
        style={{
          color: colors.text,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          fontFamily: 'Inter',
        }}
      />
      {hint ? <Text className="text-xs text-muted-foreground mt-1.5">{hint}</Text> : null}
    </View>
  );
}

type Step = 'credentials' | 'otp';

export default function ZebpayConnectCredentialsScreen() {
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [step, setStep] = useState<Step>('credentials');
  const [clientId, setClientId]         = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [countryCode, setCountryCode]   = useState('91');
  const [mobile, setMobile]             = useState('');
  const [pin, setPin]                   = useState('');
  const [otp, setOtp]                   = useState('');
  const [isLoading, setIsLoading]       = useState(true);
  const [isBusy, setIsBusy]             = useState(false);

  useEffect(() => {
    getZebpayCredentials()
      .then(creds => {
        if (creds) {
          setClientId(creds.clientId);
          setClientSecret(creds.clientSecret);
          setMobile(creds.mobile);
          setPin(creds.pin);
          setCountryCode(creds.countryCode ?? '91');
        }
      })
      .catch(e => logger.error('Failed to load Zebpay credentials:', e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSendOTP = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !mobile.trim() || !pin.trim()) {
      alert('Missing Fields', 'Please fill in all four fields.');
      return;
    }
    setIsBusy(true);
    try {
      await startZebpayConnect(clientId.trim(), clientSecret.trim(), mobile.trim(), pin.trim(), countryCode.trim() || '91');
      setStep('otp');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Failed', msg || 'Could not send OTP. Check your credentials and try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim()) {
      alert('Enter OTP', 'Please enter the OTP sent to your mobile number.');
      return;
    }
    setIsBusy(true);
    try {
      await completeZebpayConnect(otp.trim());
      alert('Connected', 'Zebpay account connected successfully.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Connection Failed', msg || 'OTP verification failed. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleClear = () => {
    alert(
      'Remove Credentials',
      'This will disconnect your Zebpay account and remove all stored credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearZebpayCredentials();
              setClientId(''); setClientSecret(''); setCountryCode('91'); setMobile(''); setPin(''); setOtp('');
              setStep('credentials');
              router.back();
            } catch (e) {
              logger.error('Failed to clear Zebpay credentials:', e);
              alert('Error', 'Failed to remove credentials.');
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.primary} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mx-4 mt-3">

          {step === 'credentials' ? (
            <>
              <Card className="mb-3">
                <Field
                  label="Client ID"
                  value={clientId}
                  onChange={setClientId}
                  placeholder="Your Zebpay API client ID"
                  hint="From Zebpay developer portal → your app"
                  colors={colors}
                />
                <Field
                  label="Client Secret"
                  value={clientSecret}
                  onChange={setClientSecret}
                  placeholder="Your API client secret"
                  secure
                  colors={colors}
                />
                <View className="mb-4">
                  <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Mobile Number
                  </Text>
                  <View className="flex-row gap-2">
                    <View className="flex-row items-center rounded-lg px-3"
                      style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, minWidth: 72 }}>
                      <Text className="text-sm text-muted-foreground mr-1">+</Text>
                      <TextInput
                        value={countryCode}
                        onChangeText={v => setCountryCode(v.replace(/\D/g, ''))}
                        placeholder="91"
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="numeric"
                        maxLength={4}
                        style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter', minWidth: 36, paddingVertical: 10 }}
                      />
                    </View>
                    <TextInput
                      value={mobile}
                      onChangeText={setMobile}
                      placeholder="Mobile number"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="phone-pad"
                      style={{
                        flex: 1,
                        color: colors.text,
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        fontSize: 14,
                        fontFamily: 'Inter',
                      }}
                    />
                  </View>
                  <Text className="text-xs text-muted-foreground mt-1.5">
                    Country code + number registered with your Zebpay account
                  </Text>
                </View>
                <Field
                  label="PIN"
                  value={pin}
                  onChange={setPin}
                  placeholder="Your Zebpay app PIN"
                  secure
                  keyboardType="numeric"
                  colors={colors}
                />
              </Card>

              <View className="flex-row gap-3 mb-3">
                <Pressable
                  onPress={handleSendOTP}
                  disabled={isBusy}
                  className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
                  style={{ backgroundColor: theme.primary, opacity: isBusy ? 0.7 : 1 }}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="send-outline" size={18} color="#fff" />
                      <Text className="text-white font-semibold text-sm ml-2">Send OTP</Text>
                    </>
                  )}
                </Pressable>

                {clientId ? (
                  <Pressable
                    onPress={handleClear}
                    className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
                    style={{ backgroundColor: theme.danger }}
                  >
                    <Ionicons name="trash-outline" size={18} color="#fff" />
                    <Text className="text-white font-semibold text-sm ml-2">Remove</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => router.back()}
                    className="flex-1 rounded-lg p-3.5 items-center justify-center border border-border"
                    style={{ backgroundColor: colors.surface }}
                  >
                    <Text className="text-sm font-semibold text-foreground">Cancel</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : (
            <>
              {/* OTP step */}
              <Card className="mb-3">
                <View className="flex-row items-center mb-3">
                  <Ionicons name="phone-portrait-outline" size={20} color={theme.primary} />
                  <Text className="text-sm font-semibold ml-2 flex-1">
                    OTP sent to +{countryCode} {mobile}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground mb-4">
                  Enter the 6-digit OTP from your Zebpay SMS.
                </Text>
                <Field
                  label="OTP"
                  value={otp}
                  onChange={setOtp}
                  placeholder="6-digit OTP"
                  keyboardType="numeric"
                  colors={colors}
                />
              </Card>

              <View className="flex-row gap-3 mb-3">
                <Pressable
                  onPress={handleVerifyOTP}
                  disabled={isBusy}
                  className="flex-1 rounded-lg p-3.5 flex-row items-center justify-center"
                  style={{ backgroundColor: theme.primary, opacity: isBusy ? 0.7 : 1 }}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text className="text-white font-semibold text-sm ml-2">Verify & Connect</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => { setStep('credentials'); setOtp(''); }}
                  className="flex-1 rounded-lg p-3.5 items-center justify-center border border-border"
                  style={{ backgroundColor: colors.surface }}
                >
                  <Text className="text-sm font-semibold text-foreground">Back</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Help */}
          <Card>
            <View className="flex-row items-center mb-2">
              <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
              <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
                How to get API credentials
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5">
              {'1. Log in to Zebpay → go to API Settings\n'}
              {'2. Create a new app to get Client ID and Client Secret\n'}
              {'3. Your mobile number is the one registered with Zebpay\n'}
              {'4. PIN is your Zebpay app PIN (4–6 digits)\n'}
              {'5. Tap "Send OTP" — Zebpay sends a one-time code to your mobile'}
            </Text>
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
