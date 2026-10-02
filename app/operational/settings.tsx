import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type BusinessDay = { is_open: boolean; opens_at: string; closes_at: string };
type BusinessHours = Record<string, BusinessDay>;
type SettingRow = { key: string; value: unknown };

export default function SettingsScreen() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [hours, setHours] = useState<BusinessHours>({});
  const [cancellation, setCancellation] = useState("");
  const [rescheduling, setRescheduling] = useState("");
  const [reminder, setReminder] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [slotInterval, setSlotInterval] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = profile?.role === "ADMIN";
  const settings = useQuery({
    queryKey: ["app-settings"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("app_settings").select("key,value");
      if (queryError) throw queryError;
      return data as SettingRow[];
    },
  });
  useEffect(() => {
    if (!settings.data) return;
    const values = Object.fromEntries(settings.data.map(({ key, value }) => [key, value])) as Record<string, unknown>;
    const hoursValue = values.business_hours as BusinessHours | undefined;
    if (hoursValue) setHours(hoursValue);
    setCancellation(String((values.cancellation_policy as { minimum_hours_before?: number } | undefined)?.minimum_hours_before ?? ""));
    setRescheduling(String((values.rescheduling_policy as { minimum_hours_before?: number } | undefined)?.minimum_hours_before ?? ""));
    setReminder(String((values.reminder_settings as { hours_before?: number } | undefined)?.hours_before ?? ""));
    const booking = values.booking_settings as { maximum_days_ahead?: number; slot_interval_minutes?: number } | undefined;
    setMaxDays(String(booking?.maximum_days_ahead ?? ""));
    setSlotInterval(String(booking?.slot_interval_minutes ?? ""));
  }, [settings.data]);
  if (!isAdmin) return <Screen><Heading title="Studio settings" subtitle="Settings are available to administrators only." /></Screen>;
  const changeDay = (day: number, field: keyof BusinessDay, value: string | boolean) => {
    setHours((previous) => {
      const prior = previous[String(day)] ?? { is_open: false, opens_at: "", closes_at: "" };
      return { ...previous, [String(day)]: { ...prior, [field]: value } };
    });
  };
  const saveSettings = async () => {
    setError("");
    const numeric = (value: string, label: string, maximum = 720, minimum = 0) => {
      if (!value.trim()) throw new Error(`${label} must be configured before saving.`);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
      return parsed;
    };
    try {
      for (const [index, day] of days.entries()) {
        const value = hours[String(index)];
        if (value?.is_open && (!/^\d{2}:\d{2}$/.test(value.opens_at) || !/^\d{2}:\d{2}$/.test(value.closes_at) || value.opens_at >= value.closes_at)) {
          throw new Error(`${day}: provide valid opening and closing times, or mark the day closed.`);
        }
      }
      const values = [
        { key: "business_hours", value: hours },
        { key: "cancellation_policy", value: { minimum_hours_before: numeric(cancellation, "Cancellation window") } },
        { key: "rescheduling_policy", value: { minimum_hours_before: numeric(rescheduling, "Rescheduling window") } },
        { key: "reminder_settings", value: { hours_before: numeric(reminder, "Reminder timing", 168, 1) } },
        { key: "booking_settings", value: {
          maximum_days_ahead: numeric(maxDays, "Booking horizon", 365),
          slot_interval_minutes: numeric(slotInterval, "Booking slot interval", 120, 5),
        } },
      ];
      setBusy(true);
      for (const setting of values) {
        const { error: saveError } = await supabase.from("app_settings")
          .upsert({ ...setting, updated_by: profile?.id }, { onConflict: "key" });
        if (saveError) throw saveError;
      }
      await client.invalidateQueries({ queryKey: ["app-settings"] });
      setError("Settings saved. Business hours are applied to online availability.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally { setBusy(false); }
  };
  return <Screen>
    <Heading title="Studio settings" subtitle="Set studio policies and hours; no business rules are assumed until you configure them." />
    {settings.isError ? <ErrorText>Settings could not be loaded. {settings.error.message}</ErrorText> : null}
    {days.map((day, index) => {
      const value = hours[String(index)] ?? { is_open: false, opens_at: "", closes_at: "" };
      return <View key={day} style={{ padding: 14, borderBottomColor: "#EDE3E4", borderBottomWidth: 1 }}>
        <Text onPress={() => changeDay(index, "is_open", !value.is_open)} style={{ color: colors.ink, fontWeight: "700", paddingVertical: 7 }}>
          {value.is_open ? "☑" : "☐"} {day}
        </Text>
        {value.is_open ? <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Opens (HH:MM)" value={value.opens_at} onChangeText={(text) => changeDay(index, "opens_at", text)} /></View>
          <View style={{ flex: 1 }}><Field label="Closes (HH:MM)" value={value.closes_at} onChangeText={(text) => changeDay(index, "closes_at", text)} /></View>
        </View> : null}
      </View>;
    })}
    <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 22, marginBottom: 8 }}>Booking and cancellation rules</Text>
    <Field label="Cancellation allowed until (hours before)" value={cancellation} onChangeText={setCancellation} keyboardType="phone-pad" />
    <Field label="Rescheduling allowed until (hours before)" value={rescheduling} onChangeText={setRescheduling} keyboardType="phone-pad" />
    <Field label="Appointment reminder timing (hours before)" value={reminder} onChangeText={setReminder} keyboardType="phone-pad" />
    <Field label="Maximum booking horizon (days ahead)" value={maxDays} onChangeText={setMaxDays} keyboardType="phone-pad" />
    <Field label="Time slot interval (minutes, 5–120)" value={slotInterval} onChangeText={setSlotInterval} keyboardType="phone-pad" />
    {error ? <Text style={{ color: error.includes("saved") ? colors.rose : "#B54545", marginBottom: 12 }}>{error}</Text> : null}
    <ActionButton label="Save settings" onPress={() => void saveSettings()} busy={busy} />
  </Screen>;
}
