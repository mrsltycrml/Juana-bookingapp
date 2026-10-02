import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, ErrorText, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import type { NotificationItem } from "@/types/database";

export default function NotificationsScreen() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const notifications = useQuery({
    queryKey: ["notifications", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("notifications").select("*")
        .eq("profile_id", profile!.id).order("created_at", { ascending: false }).limit(50);
      if (queryError) throw queryError;
      return data as NotificationItem[];
    },
  });
  const preferences = useQuery({
    queryKey: ["notification-preferences", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("notification_preferences").select("*").eq("profile_id", profile!.id).single();
      if (queryError) throw queryError;
      return data;
    },
  });
  const setPreference = async (field: "push_enabled" | "email_enabled" | "appointment_reminders", value: boolean) => {
    setError("");
    const { error: updateError } = await supabase.from("notification_preferences")
      .update({ [field]: value }).eq("profile_id", profile?.id);
    if (updateError) setError(updateError.message);
    else await queryClient.invalidateQueries({ queryKey: ["notification-preferences", profile?.id] });
  };
  return <Screen>
    <Heading title="Notifications" subtitle="Your studio updates and reminder preferences." />
    <Card>
      {(["push_enabled", "email_enabled", "appointment_reminders"] as const).map((key) => <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
        <Text style={{ color: colors.ink, flex: 1 }}>{key === "push_enabled" ? "Push notifications" : key === "email_enabled" ? "Email updates" : "Appointment reminders"}</Text>
        <Switch value={preferences.data?.[key] ?? false} onValueChange={(value) => void setPreference(key, value)} />
      </View>)}
    </Card>
    {error ? <ErrorText>{error}</ErrorText> : null}
    {notifications.isError ? <ErrorText>Notifications could not be loaded. {notifications.error.message}</ErrorText> : null}
    {notifications.data?.map((item) => <Card key={item.id}>
      <Text style={{ color: colors.ink, fontWeight: item.read_at ? "500" : "700" }}>{item.title}</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>{item.body}</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>{new Date(item.created_at).toLocaleString()}</Text>
    </Card>)}
    {notifications.data?.length === 0 ? <Text style={{ color: colors.muted }}>No notifications yet.</Text> : null}
  </Screen>;
}
