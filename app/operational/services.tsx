import { useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ActionButton, Card, ErrorText, Field, Heading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/utils/format";
import type { Service } from "@/types/database";

const formSchema = z.object({
  name: z.string().trim().min(2, "Enter a service name."),
  description: z.string().trim().min(2, "Enter a service description."),
  category: z.string().trim().min(2, "Enter a category."),
  price: z.coerce.number().finite().min(0, "Price cannot be negative."),
  duration: z.coerce.number().int().min(5).max(720, "Duration must be between 5 minutes and 12 hours."),
  currency: z.string().trim().length(3).default("PHP"),
  requiresConsent: z.boolean(),
});
type ServiceValues = z.output<typeof formSchema>;
type ServiceFormInput = z.input<typeof formSchema>;

export default function ServicesManagement() {
  const { profile } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [imageUri, setImageUri] = useState("");
  const [imageMime, setImageMime] = useState("image/jpeg");
  const [imageVersion, setImageVersion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = profile?.role === "ADMIN";
  const canView = isAdmin || profile?.role === "FRONT_DESK";
  const services = useQuery({
    queryKey: ["admin-services"],
    enabled: canView,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("services").select("*").order("category").order("name");
      if (queryError) throw queryError;
      return data as Service[];
    },
  });
  const { control, handleSubmit, reset, formState: { errors } } = useForm<ServiceFormInput, unknown, ServiceValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", category: "", price: 0, duration: 30, currency: "PHP", requiresConsent: false },
  });
  const startEdit = (item: Service) => {
    setEditorOpen(true);
    setEditing(item); setImageUri(""); setImageMime("image/jpeg"); setImageVersion("");
    reset({
      name: item.name, description: item.description, category: item.category,
      price: item.price_amount, duration: item.duration_minutes, currency: item.currency,
      requiresConsent: item.requires_consent,
    });
  };
  const createNew = () => {
    setEditorOpen(true);
    setEditing(null); setImageUri(""); setImageMime("image/jpeg"); setImageVersion("");
    reset({ name: "", description: "", category: "", price: 0, duration: 30, currency: "PHP", requiresConsent: false });
  };
  const selectImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Photo library permission is required to select a service image."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      setImageMime(result.assets[0].mimeType ?? "image/jpeg");
      setImageVersion(String(Date.now()));
    }
  };
  const save = async (values: ServiceValues) => {
    if (!isAdmin) { setError("Only an administrator can manage services."); return; }
    setBusy(true); setError("");
    try {
      const payload = {
        name: values.name.trim(), description: values.description.trim(), category: values.category.trim(),
        price_amount: values.price, duration_minutes: values.duration, currency: values.currency.toUpperCase(),
        requires_consent: values.requiresConsent,
      };
      let serviceId = editing?.id;
      if (serviceId) {
        const { error: updateError } = await supabase.from("services").update(payload).eq("id", serviceId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase.from("services").insert(payload).select("id").single();
        if (insertError) throw insertError;
        serviceId = data.id;
      }
      if (imageUri && serviceId) {
        const response = await fetch(imageUri);
        const image = await response.blob();
        const extension = imageMime === "image/png" ? "png" : imageMime === "image/webp" ? "webp" : "jpg";
        const path = `services/${serviceId}/${imageVersion}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("service-images")
          .upload(path, image, { contentType: imageMime });
        if (uploadError) throw uploadError;
        const { error: imageError } = await supabase.from("services").update({ image_path: path }).eq("id", serviceId);
        if (imageError) throw imageError;
      }
      setEditing(null);
      setEditorOpen(false);
      await client.invalidateQueries({ queryKey: ["admin-services"] });
      await client.invalidateQueries({ queryKey: ["services"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Service could not be saved.");
    } finally { setBusy(false); }
  };
  const deactivate = (item: Service) => Alert.alert("Deactivate service?", "It will no longer appear in client booking. Historical appointments remain unchanged.", [
    { text: "Keep active", style: "cancel" },
    { text: "Deactivate", style: "destructive", onPress: () => {
      void (async () => {
        try {
          const { error: updateError } = await supabase.from("services").update({ is_active: false }).eq("id", item.id);
          if (updateError) throw updateError;
          await client.invalidateQueries({ queryKey: ["admin-services"] });
          await client.invalidateQueries({ queryKey: ["services"] });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Service could not be deactivated.");
        }
      })();
    } },
  ]);
  if (!canView) return <Screen><Heading title="Services" subtitle="Service management is available to studio staff." /></Screen>;
  if (editorOpen) return <Screen scroll>
    <Heading title={editing ? "Edit service" : "New service"} subtitle="Set the customer-facing price and duration." />
    {error ? <ErrorText>{error}</ErrorText> : null}
    <ServiceEditor
      visible
      control={control}
      errors={errors}
      busy={busy}
      imageUri={imageUri}
      onPickImage={() => void selectImage()}
      onSave={handleSubmit(save)}
      onCancel={() => { setEditorOpen(false); setError(""); }}
    />
  </Screen>;
  return <Screen>
    <Heading title="Services" subtitle="Create, edit, and deactivate bookable services." />
    {error ? <ErrorText>{error}</ErrorText> : null}
    {isAdmin ? <ActionButton label="Add a service" onPress={createNew} /> : null}
    {services.isError ? <ErrorText>Services could not be loaded. {services.error.message}</ErrorText> : null}
    {services.data?.map((item) => <Card key={item.id}>
      {item.image_path ? <Image source={{ uri: supabase.storage.from("service-images").getPublicUrl(item.image_path).data.publicUrl }} style={{ width: "100%", height: 145, borderRadius: 14, marginBottom: 12 }} /> : null}
      <Text style={{ color: colors.rose, fontWeight: "700" }}>{item.category} · {item.is_active ? "ACTIVE" : "INACTIVE"}</Text>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 5 }}>{item.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 5 }}>{formatMoney(item.price_amount, item.currency)} · {item.duration_minutes} minutes</Text>
      {isAdmin ? <View style={{ flexDirection: "row", gap: 20, marginTop: 12 }}>
        <Text onPress={() => startEdit(item)} style={{ color: colors.rose, fontWeight: "600" }}>Edit</Text>
        {item.is_active ? <Text onPress={() => deactivate(item)} style={{ color: colors.muted }}>Deactivate</Text> : null}
      </View> : null}
    </Card>)}
  </Screen>;
}

function ServiceEditor({ visible, control, errors, busy, imageUri, onPickImage, onSave, onCancel }: {
  visible: boolean; control: Control<ServiceFormInput, unknown, ServiceValues>;
  errors: FieldErrors<ServiceFormInput>;
  busy: boolean; imageUri: string; onPickImage: () => void; onSave: () => void; onCancel: () => void;
}) {
  if (!visible) return null;
  return <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.cream, padding: 22 }}>
    <Heading title="Service details" subtitle="Set the customer-facing price and duration." />
    {(["name", "description", "category", "price", "duration", "currency"] as const).map((field) => <Controller key={field} control={control} name={field}
      render={({ field: input }) => <Field label={field === "price" ? "Full price" : field === "duration" ? "Duration in minutes" : field === "name" ? "Name" : field === "description" ? "Description" : field === "category" ? "Category" : "Currency code"}
        value={String(input.value)} onChangeText={input.onChange} keyboardType={field === "price" || field === "duration" ? "phone-pad" : "default"} multiline={field === "description"} />} />)}
    {Object.values(errors).map((item, index) => <ErrorText key={index}>{item.message}</ErrorText>)}
    <Controller control={control} name="requiresConsent" render={({ field }) => <Text onPress={() => field.onChange(!field.value)} style={{ color: colors.ink, paddingVertical: 14 }}>{field.value ? "☑" : "☐"} Consent form required</Text>} />
    <Text onPress={onPickImage} style={{ color: colors.rose, paddingVertical: 12 }}>Choose service image</Text>
    {imageUri ? <Image source={{ uri: imageUri }} style={{ width: 120, height: 90, borderRadius: 12 }} /> : null}
    <ActionButton label="Save service" onPress={onSave} busy={busy} />
    <Text onPress={onCancel} style={{ color: colors.muted, textAlign: "center", padding: 15 }}>Cancel</Text>
  </View>;
}
