import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushNotifications(profileId: string): Promise<void> {
  if (!Device.isDevice) return;
  const permission = await Notifications.getPermissionsAsync();
  const finalStatus = permission.status === "granted"
    ? permission.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== "granted") return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("Configure an EAS project ID to enable push notifications.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("appointments", {
      name: "Appointments",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { error } = await supabase.from("notification_preferences")
    .upsert({ profile_id: profileId, expo_push_token: token, push_enabled: true }, { onConflict: "profile_id" });
  if (error) throw error;
}
