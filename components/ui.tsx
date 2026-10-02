import type { PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const colors = {
  ink: "#362A30",
  muted: "#88777F",
  rose: "#B66B7C",
  blush: "#F8EEF0",
  cream: "#FFFCFA",
  line: "#EDE3E4",
  white: "#FFFFFF",
  danger: "#B54545",
};

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const content = scroll ? <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 36 }}>{children}</ScrollView> : children;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>{content}</SafeAreaView>;
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={{ marginBottom: 22 }}>
    <Text style={{ fontSize: 27, lineHeight: 33, color: colors.ink, fontWeight: "700" }}>{title}</Text>
    {subtitle ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 6 }}>{subtitle}</Text> : null}
  </View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[{ backgroundColor: colors.white, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.line, marginBottom: 12 }, style]}>{children}</View>;
}

export function ActionButton({ label, onPress, busy, variant = "primary", disabled }: {
  label: string; onPress: () => void; busy?: boolean; variant?: "primary" | "secondary"; disabled?: boolean;
}) {
  const primary = variant === "primary";
  return <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={onPress} style={{
    minHeight: 54, borderRadius: 16, justifyContent: "center", alignItems: "center", paddingHorizontal: 18,
    backgroundColor: primary ? colors.rose : colors.blush, opacity: disabled ? 0.55 : 1,
  }}>
    {busy ? <ActivityIndicator color={primary ? colors.white : colors.rose} /> :
      <Text style={{ color: primary ? colors.white : colors.rose, fontWeight: "700", fontSize: 15 }}>{label}</Text>}
  </Pressable>;
}

export function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  secureTextEntry?: boolean; keyboardType?: "email-address" | "phone-pad" | "default"; multiline?: boolean;
}) {
  return <View style={{ marginBottom: 15 }}>
    <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600", marginBottom: 7 }}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder ?? label} placeholderTextColor={colors.muted}
      secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      multiline={multiline} style={{
        minHeight: multiline ? 96 : 52, textAlignVertical: multiline ? "top" : "center", paddingHorizontal: 15,
        paddingVertical: multiline ? 12 : 0, borderWidth: 1, borderColor: colors.line, borderRadius: 14,
        backgroundColor: colors.white, color: colors.ink, fontSize: 15,
      }} />
  </View>;
}

export function ErrorText({ children }: PropsWithChildren) {
  return <Text accessibilityRole="alert" style={{ color: colors.danger, lineHeight: 20, marginBottom: 12 }}>{children}</Text>;
}

export { colors };
