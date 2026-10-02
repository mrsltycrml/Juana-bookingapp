import { useState } from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/database";

export default function CustomersScreen() {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const customers = useQuery({
    queryKey: ["customers"],
    enabled: profile?.role !== "PRACTITIONER",
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("profiles")
        .select("id,role,full_name,email,mobile_number,avatar_path,is_active")
        .eq("role", "CLIENT").order("full_name").limit(200);
      if (queryError) throw queryError;
      return data as Profile[];
    },
  });
  const visible = customers.data?.filter((person) =>
    `${person.full_name} ${person.email} ${person.mobile_number ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  ) ?? [];
  const inviteCustomer = async () => {
    const email = search.trim();
    if (!email.includes("@")) { setError("Enter the customer’s email address in the search field first."); return; }
    setError("");
    const { data, error: inviteError } = await supabase.functions.invoke("admin-create-account", {
      body: { email, fullName: email.split("@")[0], role: "CLIENT" },
    });
    if (inviteError || data?.error) setError(inviteError?.message ?? data.error);
    else setError("Customer invitation sent. Ask them to complete registration from their email.");
  };
  return <Screen>
    <Heading title="Customers" subtitle="Find a customer by name, mobile number, or email." />
    <Field label="Search customers" value={search} onChangeText={setSearch} placeholder="Name, mobile or email" />
    {profile?.role === "ADMIN" || profile?.role === "FRONT_DESK" ? <ActionButton label="Invite customer using this email" variant="secondary" onPress={() => void inviteCustomer()} /> : null}
    {error ? <Text style={{ color: colors.rose, lineHeight: 20, marginVertical: 12 }}>{error}</Text> : null}
    {customers.isError ? <ErrorText>Customer search failed. {customers.error.message}</ErrorText> : null}
    {visible.map((person) => <Pressable key={person.id} onPress={() => router.push({ pathname: "/operational/customer/[id]", params: { id: person.id } })}>
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }}>{person.full_name}</Text>
        <Text style={{ color: colors.muted, marginTop: 5 }}>{person.mobile_number ?? "No mobile number"}</Text>
        <Text style={{ color: colors.muted, marginTop: 3 }}>{person.email}</Text>
      </Card>
    </Pressable>)}
    {visible.length === 0 && !customers.isLoading ? <Text style={{ color: colors.muted }}>No customers match that search.</Text> : null}
  </Screen>;
}
