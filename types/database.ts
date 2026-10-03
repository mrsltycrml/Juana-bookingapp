export type AppRole = "CLIENT" | "ADMIN" | "FRONT_DESK" | "PRACTITIONER";
export type AppointmentStatus =
  | "TEMPORARILY_RESERVED"
  | "BOOKED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RESCHEDULED";
export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface Profile {
  id: string;
  role: AppRole;
  full_name: string;
  email: string;
  mobile_number: string | null;
  avatar_path: string | null;
  is_active: boolean;
  terms_accepted_at?: string | null;
  privacy_accepted_at?: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  image_path: string | null;
  price_amount: number;
  currency: string;
  duration_minutes: number;
  requires_consent: boolean;
  is_active: boolean;
  showcase_run_id?: string | null;
}

export interface Practitioner {
  id: string;
  profile_id: string;
  display_name: string;
  bio: string | null;
  is_active: boolean;
  showcase_run_id?: string | null;
}

export interface Appointment {
  id: string;
  customer_id: string;
  practitioner_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  reservation_expires_at: string | null;
  service_snapshot: Record<string, unknown>;
  showcase_run_id?: string | null;
  practitioner?: Practitioner | null;
  service?: Service | null;
  customer?: Profile | null;
  payments?: Payment[];
}

export interface Payment {
  id: string;
  appointment_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
}

export interface ConsentForm {
  id: string;
  service_id: string | null;
  title: string;
  description: string;
  is_active: boolean;
  current_version_id: string | null;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
