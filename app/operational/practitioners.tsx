import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import type { Practitioner, Service } from "@/types/database";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PractitionersScreen() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [dayOff, setDayOff] = useState("");
  const [blockedDate, setBlockedDate] = useState("");
  const [blockedStart, setBlockedStart] = useState("");
  const [blockedEnd, setBlockedEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = profile?.role === "ADMIN";
  const practitioners = useQuery({
    queryKey: ["practitioners"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("practitioners")
        .select("id,profile_id,display_name,bio,is_active").order("display_name");
      if (queryError) throw queryError;
      return data as Practitioner[];
    },
  });
  const services = useQuery({
    queryKey: ["admin-services"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("services").select("*").order("name");
      if (queryError) throw queryError;
      return data as Service[];
    },
  });
  const schedules = useQuery({
    queryKey: ["practitioner-schedules", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("availability_schedules")
        .select("*").eq("practitioner_id", selected).order("weekday");
      if (queryError) throw queryError;
      return data;
    },
  });
  const assignments = useQuery({
    queryKey: ["practitioner-service-assignments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("practitioner_services")
        .select("service_id").eq("practitioner_id", selected);
      if (queryError) throw queryError;
      return new Set((data ?? []).map((entry) => entry.service_id));
    },
  });
  const blocks = useQuery({
    queryKey: ["practitioner-blocks", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("blocked_periods")
        .select("id,starts_at,ends_at,reason").eq("practitioner_id", selected).order("starts_at");
      if (queryError) throw queryError;
      return data;
    },
  });
  if (!isAdmin) return <Screen><Heading title="Practitioners" subtitle="Practitioner management is available to administrators only." /></Screen>;

  const invite = async () => {
    if (fullName.trim().length < 2 || !email.includes("@")) { setError("Enter the practitioner’s full name and a valid email."); return; }
    setBusy(true); setError("");
    const { data, error: inviteError } = await supabase.functions.invoke("admin-create-account", {
      body: { email: email.trim(), fullName: fullName.trim(), mobileNumber: mobile.trim(), role: "PRACTITIONER" },
    });
    setBusy(false);
    if (inviteError || data?.error) setError(inviteError?.message ?? data.error);
    else {
      setError("Invitation sent. The practitioner will appear here after accepting it.");
      setFullName(""); setEmail(""); setMobile("");
      await client.invalidateQueries({ queryKey: ["practitioners"] });
    }
  };
  const updateActive = async (person: Practitioner) => {
    const { error: updateError } = await supabase.from("practitioners").update({ is_active: !person.is_active }).eq("id", person.id);
    if (updateError) setError(updateError.message);
    else await client.invalidateQueries({ queryKey: ["practitioners"] });
  };
  const saveSchedule = async (weekday: number, opensAt: string, closesAt: string, working: boolean, breakStartsAt: string, breakEndsAt: string) => {
    if (working && (!/^\d{2}:\d{2}$/.test(opensAt) || !/^\d{2}:\d{2}$/.test(closesAt) || opensAt >= closesAt)) {
      setError("Enter valid 24-hour opening and closing times."); return;
    }
    if (working && (!!breakStartsAt !== !!breakEndsAt
      || (breakStartsAt && (!/^\d{2}:\d{2}$/.test(breakStartsAt) || !/^\d{2}:\d{2}$/.test(breakEndsAt)
        || breakStartsAt < opensAt || breakEndsAt > closesAt || breakStartsAt >= breakEndsAt)))) {
      setError("Break times must be paired and fall within the working hours."); return;
    }
    setError("");
    const { error: saveError } = await supabase.from("availability_schedules").upsert({
      practitioner_id: selected,
      weekday,
      opens_at: working ? opensAt : "09:00",
      closes_at: working ? closesAt : "17:00",
      break_starts_at: working && breakStartsAt ? breakStartsAt : null,
      break_ends_at: working && breakEndsAt ? breakEndsAt : null,
      is_working: working,
    }, { onConflict: "practitioner_id,weekday" });
    if (saveError) setError(saveError.message);
    else await client.invalidateQueries({ queryKey: ["practitioner-schedules", selected] });
  };
  const toggleService = async (serviceId: string) => {
    const assigned = assignments.data?.has(serviceId) ?? false;
    const result = assigned
      ? await supabase.from("practitioner_services").delete().eq("practitioner_id", selected).eq("service_id", serviceId)
      : await supabase.from("practitioner_services").insert({ practitioner_id: selected, service_id: serviceId });
    if (result.error) setError(result.error.message);
    else await client.invalidateQueries({ queryKey: ["practitioner-service-assignments", selected] });
  };
  const saveDayOff = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOff)) { setError("Use the date format YYYY-MM-DD."); return; }
    const { error: saveError } = await supabase.from("availability_exceptions").upsert({
      practitioner_id: selected, exception_date: dayOff, is_working: false, reason: "Practitioner day off",
    }, { onConflict: "practitioner_id,exception_date" });
    if (saveError) setError(saveError.message);
    else { setDayOff(""); setError("Day off saved."); }
  };
  const saveBlock = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(blockedDate) || !/^\d{2}:\d{2}$/.test(blockedStart) || !/^\d{2}:\d{2}$/.test(blockedEnd) || blockedStart >= blockedEnd) {
      setError("Enter a date (YYYY-MM-DD) and valid 24-hour start/end times."); return;
    }
    const { error: insertError } = await supabase.from("blocked_periods").insert({
      practitioner_id: selected,
      starts_at: new Date(`${blockedDate}T${blockedStart}:00+08:00`).toISOString(),
      ends_at: new Date(`${blockedDate}T${blockedEnd}:00+08:00`).toISOString(),
      reason: "Blocked by administrator",
      created_by: profile?.id,
    });
    if (insertError) setError(insertError.message);
    else {
      setBlockedDate(""); setBlockedStart(""); setBlockedEnd("");
      await client.invalidateQueries({ queryKey: ["practitioner-blocks", selected] });
    }
  };
  const removeBlock = (blockId: string) => Alert.alert("Remove blocked time?", "Appointments may become available in this period.", [
    { text: "Keep block", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => {
      void (async () => {
        try {
          const { error: deleteError } = await supabase.from("blocked_periods").delete().eq("id", blockId);
          if (deleteError) throw deleteError;
          await client.invalidateQueries({ queryKey: ["practitioner-blocks", selected] });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Blocked period could not be removed.");
        }
      })();
    } },
  ]);

  if (selected) {
    const scheduleByDay = new Map((schedules.data ?? []).map((entry) => [entry.weekday, entry]));
    return <Screen>
      <Text onPress={() => setSelected("")} style={{ color: colors.rose, marginBottom: 12 }}>‹ All practitioners</Text>
      <Heading title={practitioners.data?.find((person) => person.id === selected)?.display_name ?? "Schedule"} subtitle="Schedules only determine booking availability; they are not attendance records." />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Text style={{ color: colors.ink, fontWeight: "700", marginBottom: 8 }}>Services performed</Text>
      {services.data?.map((service) => <Text key={service.id} onPress={() => void toggleService(service.id)} style={{ color: colors.ink, paddingVertical: 9 }}>
        {(assignments.data?.has(service.id) ?? false) ? "☑" : "☐"}  {service.name}
      </Text>)}
      <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 18, marginBottom: 8 }}>Weekly schedule</Text>
      {weekdays.map((day, weekday) => {
        const entry = scheduleByDay.get(weekday);
        return <ScheduleDay key={day} day={day} entry={entry} onSave={(open, close, working, breakStart, breakEnd) => void saveSchedule(weekday, open, close, working, breakStart, breakEnd)} />;
      })}
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>Add a day off</Text>
        <Field label="Date (YYYY-MM-DD)" value={dayOff} onChangeText={setDayOff} />
        <ActionButton label="Save day off" variant="secondary" onPress={() => void saveDayOff()} />
      </Card>
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>Block a time period</Text>
        <Field label="Date (YYYY-MM-DD)" value={blockedDate} onChangeText={setBlockedDate} />
        <Field label="Start time (24-hour HH:MM)" value={blockedStart} onChangeText={setBlockedStart} />
        <Field label="End time (24-hour HH:MM)" value={blockedEnd} onChangeText={setBlockedEnd} />
        <ActionButton label="Block time" variant="secondary" onPress={() => void saveBlock()} />
      </Card>
      {blocks.data?.map((block) => <Card key={block.id}>
        <Text style={{ color: colors.ink }}>{new Date(block.starts_at).toLocaleString()} – {new Date(block.ends_at).toLocaleTimeString()}</Text>
        <Text onPress={() => removeBlock(block.id)} style={{ color: colors.rose, marginTop: 8 }}>Remove blocked period</Text>
      </Card>)}
    </Screen>;
  }
  return <Screen>
    <Heading title="Practitioners" subtitle="Manage practitioner profiles, services, and availability." />
    <Card>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>Invite a practitioner</Text>
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Mobile number" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <ActionButton label="Send invitation" onPress={() => void invite()} busy={busy} />
    </Card>
    {error ? <ErrorText>{error}</ErrorText> : null}
    {practitioners.isError ? <ErrorText>Practitioners could not be loaded. {practitioners.error.message}</ErrorText> : null}
    {practitioners.data?.map((person) => <Card key={person.id}>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{person.display_name}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{person.is_active ? "Active" : "Inactive"}</Text>
      <View style={{ flexDirection: "row", gap: 20, marginTop: 13 }}>
        <Text onPress={() => setSelected(person.id)} style={{ color: colors.rose, fontWeight: "600" }}>Services & schedule</Text>
        <Text onPress={() => void updateActive(person)} style={{ color: colors.muted }}>{person.is_active ? "Deactivate" : "Activate"}</Text>
      </View>
    </Card>)}
  </Screen>;
}

function ScheduleDay({ day, entry, onSave }: {
  day: string; entry?: { opens_at: string; closes_at: string; is_working: boolean; break_starts_at: string | null; break_ends_at: string | null };
  onSave: (open: string, close: string, working: boolean, breakStart: string, breakEnd: string) => void;
}) {
  const [open, setOpen] = useState(entry?.opens_at?.slice(0, 5) ?? "09:00");
  const [close, setClose] = useState(entry?.closes_at?.slice(0, 5) ?? "17:00");
  const [working, setWorking] = useState(entry?.is_working ?? false);
  const [breakStart, setBreakStart] = useState(entry?.break_starts_at?.slice(0, 5) ?? "");
  const [breakEnd, setBreakEnd] = useState(entry?.break_ends_at?.slice(0, 5) ?? "");
  return <Card>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{day}</Text>
      <Pressable onPress={() => setWorking((previous) => !previous)}><Text style={{ color: working ? colors.rose : colors.muted }}>{working ? "Working" : "Day off"}</Text></Pressable>
    </View>
    {working ? <>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Field label="Opens (HH:MM)" value={open} onChangeText={setOpen} /></View>
        <View style={{ flex: 1 }}><Field label="Closes (HH:MM)" value={close} onChangeText={setClose} /></View>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Field label="Break starts (optional)" value={breakStart} onChangeText={setBreakStart} /></View>
        <View style={{ flex: 1 }}><Field label="Break ends (optional)" value={breakEnd} onChangeText={setBreakEnd} /></View>
      </View>
    </> : null}
    <Text onPress={() => onSave(open, close, working, breakStart, breakEnd)} style={{ color: colors.rose, fontWeight: "600", paddingVertical: 7 }}>Save {day}</Text>
  </Card>;
}
