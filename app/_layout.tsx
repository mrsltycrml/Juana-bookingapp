import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/use-auth";
import { queryClient } from "@/lib/query-client";
import "@/global.css";

export default function RootLayout() {
  return <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#FFFCFA" } }} />
    </AuthProvider>
  </QueryClientProvider>;
}
