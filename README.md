# Juana Beauty and Aesthetics

Mobile client booking and studio operations app built with Expo, React Native, TypeScript, and Supabase. The repository includes the mobile application, a PostgreSQL migration with row-level security (RLS), and Supabase Edge Functions for trusted booking/payment/notification operations. No real business prices, practitioner names, service data, payment credentials, or consent wording are seeded.

> **Deployment status:** this source has not been connected to a live Supabase project or payment-provider account. Configure the external services below and apply the migration before using the app with real customers. A successful local bundle is not evidence of a live booking or payment integration.

## Application

- **Clients:** account access and profile, database-backed services, availability, temporary reservations, required consent, full-price checkout, appointment cancellation/rescheduling, notifications, and treatment history.
- **Studio staff:** role-gated dashboard, calendar, appointments and walk-ins, customer CRM/notes, service and practitioner management, schedules/exceptions/blocked periods, consent forms, treatment records, payments, team invitations, and settings.
- **Roles:** `CLIENT`, `ADMIN`, `FRONT_DESK`, and `PRACTITIONER`. Public sign-up creates a client profile; users cannot select a staff role.
- **Booking integrity:** PostgreSQL computes availability using business/practitioner hours and exceptions, breaks, existing appointments, active holds, booking limits, and blocked periods. Database locks and overlap checks arbitrate simultaneous reservations.
- **Payment integrity:** the server creates checkout sessions and verifies provider callbacks. Only verified full-price payment can finalize an online booking. In-person payments are explicitly `MANUAL` and require a staff-entered reference.
- **Consent integrity:** staff and clients submit against published, versioned forms. Submitted consent records and published versions are immutable.

The project intentionally does not implement attendance, time clocks, payroll, HR, employee leave, or booking approval.

## Requirements

- Node.js compatible with Expo SDK 57 (Node 20 LTS recommended) and npm.
- Expo Go for supported development-device testing, or Android Studio / Xcode for native builds.
- A Supabase project for authentication, database, RLS, Storage, Realtime, and Edge Functions.
- Docker and the Supabase CLI for local Supabase database/Edge Function integration testing.
- An EAS account/project for store-ready Android/iOS builds and reliable push notifications.
- A PayMongo or Xendit merchant account for online checkout. No gateway is required for development builds that do not initiate checkout.

## Install and run

```powershell
npm ci
Copy-Item .env.example .env
# Set the two public Supabase values in .env for your own project.
npm run start
```

Then use Expo's terminal prompt to open Android, iOS, or web. You can also run:

```powershell
npm run android
npm run ios
npm run web
```

Use `npm run ios` on macOS with Xcode. The browser target is for development convenience; this is a native mobile application, not a web page wrapped in a phone.

## Environment and secrets

The client reads only:

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key; RLS remains mandatory |

Copy [.env.example](./.env.example) to `.env` and replace the placeholders locally. Never put a service-role key, payment secret, webhook secret, or Expo access token in an `EXPO_PUBLIC_*` variable. `.env` and secret/key files are ignored by Git.

Set server-only values in Supabase Edge Function secrets (or the equivalent secure deployment environment):

| Secret | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side clients; never expose the service-role key to the app |
| `PAYMENT_PROVIDER` | `paymongo` or `xendit` |
| `PAYMENT_RETURN_URL` | Deep link opened after hosted checkout, e.g. `juanabeauty://client/appointments` |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | PayMongo API and webhook verification |
| `PAYMONGO_MODE` | `test` or `live`, matching the PayMongo signature payload |
| `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN` | Xendit API and callback verification |
| `RESERVATION_CRON_SECRET` | Bearer secret for reservation expiry/reminder jobs |
| `EXPO_ACCESS_TOKEN` | Optional Expo push service access token |

Only configure the keys for the selected provider. Configure gateway credentials and webhooks in the provider's own dashboard; never place them in app configuration or source control.

## Supabase setup

1. Create a Supabase project and configure Auth email verification, password reset, and the `juanabeauty://auth/callback` redirect URL. Configure the app's matching redirect/URL allow-list in Supabase.
2. Copy the project URL and anon/publishable key into local `.env`.
3. Install the Supabase CLI and authenticate using its supported local login flow. Do not put a personal access token in this repository.
4. Link and apply the checked-in migration:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   For an isolated local database instead, run `npx supabase start`, then `npx supabase db reset`. Local Supabase requires Docker.
5. The migrations create the profile/service/practitioner/schedule/appointment/status/consent/treatment/CRM/payment/transaction/notification/preferences/settings tables, indexes and constraints, booking and consent RPCs, RLS policies, and the service-image Storage bucket. They do not insert real studio-specific services, prices, practitioners, policies, or consent text.
6. Confirm RLS is enabled on each business table. Client data is scoped to its owner; assigned practitioners have limited appointment/customer access; front desk has operational access; admin manages configuration and staff. Sensitive changes (reservations, consent submissions, rescheduling, cancellation and treatment completion) use constrained database functions. The service-role key bypasses RLS and belongs only in trusted Edge Function configuration.

If you applied the initial schema by pasting it into the Supabase SQL Editor rather than using `supabase db push`, do not re-run the already-applied initial migration. Apply only `supabase/migrations/202610030002_showcase_data.sql` in the SQL Editor, or first repair the CLI migration history using the Supabase CLI.

### First administrator

Public sign-up can only create `CLIENT` accounts. Sign up and verify the intended first administrator normally, then promote only that account from the Supabase SQL Editor. The profile role-protection trigger intentionally blocks role changes from the app, so perform the one-time bootstrap from the trusted SQL Editor in a single transaction:

```sql
begin;

alter table public.profiles disable trigger profiles_role_guard;

update public.profiles
set role = 'ADMIN'
where lower(email) = lower('YOUR_VERIFIED_SIGNUP_EMAIL')
  and role = 'CLIENT';

alter table public.profiles enable trigger profiles_role_guard;

commit;

select email, role
from public.profiles
where lower(email) = lower('YOUR_VERIFIED_SIGNUP_EMAIL');
```

Replace the email placeholder with the exact email used for the verified signup. Confirm the final query returns `ADMIN`, then sign out of the app and sign back in. This privileged SQL is only for the initial owner bootstrap; never run it from the mobile client. After bootstrap, admins can invite/manage staff through the authenticated `admin-create-account` Edge Function.

## Edge Functions and payment setup

Deploy the checked-in functions after configuring their required secrets:

```powershell
npx supabase functions deploy create-checkout
npx supabase functions deploy payment-webhook
npx supabase functions deploy admin-create-account
npx supabase functions deploy expire-reservations
npx supabase functions deploy appointment-reminders
npx supabase secrets set PAYMENT_PROVIDER=paymongo PAYMENT_RETURN_URL=juanabeauty://client/appointments
```

Set the selected provider's API/webhook secrets using the same secure secrets command. Supabase provides project URL/key variables in its function environment; explicitly provision them if your deployment/runtime does not. `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.

Register the provider callback at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/payment-webhook
```

Configure the matching provider webhook signing secret/token and subscribe to checkout/invoice payment success and failure events. Webhook verification and a provider-side amount/reference check are required; never treat the app's return/deep link as proof of payment. Test with the provider's sandbox before enabling live credentials.

The `expire-reservations` and `appointment-reminders` functions are protected by `RESERVATION_CRON_SECRET`. Schedule authenticated POST requests to these function endpoints with `Authorization: Bearer <secret>` using Supabase Cron with a safely stored secret or another trusted scheduler. Do not expose that secret in the app. Set reminder hours in the app's admin settings. Reminder delivery additionally needs Expo push credentials/tokens and notification permission.

### Stakeholder showcase data

For a presentation, an administrator can open **More → Showcase demo data → Load showcase sample data**. First apply the showcase migration (all pending migrations with `npx supabase db push`, or only `202610030002_showcase_data.sql` in SQL Editor if the initial schema was applied manually), then deploy the `showcase-data` Edge Function:

```powershell
npx supabase functions deploy showcase-data
```

The tool creates clearly tagged sample services, two temporary practitioner accounts, four temporary client accounts, schedules, appointments, one sample treatment record, and unpaid demo-only payment placeholders. Names, prices, dates, treatments, and payment entries are fictional examples, not Juana's approved business data or real transactions. Sample service descriptions explicitly say they must be replaced; no consent language or gateway payment success is fabricated. Dashboard, calendar, service, and payment screens display demo labels.

Use **More → Showcase demo data → Remove all showcase data** to remove only records created by this tool and its temporary Auth accounts. The app does not show the generated account passwords or invite those accounts. Do not use showcase data with real customers; remove it before production use. Online checkout still requires payment-provider configuration and is not simulated.

## Expo notifications and native builds

Configure an EAS project for this app and add its project ID to the Expo configuration before shipping push notifications or store builds. Set the matching iOS APNs and Android FCM credentials in EAS. Users must grant notification permission; in-app notification history is stored separately in Supabase. A missing device token or provider credential means push delivery cannot be completed.

```powershell
npx eas-cli build:configure
npx eas-cli build --platform android
npx eas-cli build --platform ios
```

Run iOS builds from an EAS-supported environment; local iOS compilation requires macOS/Xcode.

## Validation

```powershell
npm run typecheck
npm run lint
npx expo-doctor
$env:EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY = "example-anon-key"
npx expo export --platform android
```

The placeholder environment values above only allow a compile/bundle; they do not connect to a functioning backend. `npm audit` currently reports advisories in the Expo SDK 57 / NativeWind development dependency tree. The registry recommends breaking major-version changes for several advisories; review the full report and resolve them with compatible upgrades before production rather than applying a forced downgrade.

For backend integration testing, start a disposable local Supabase stack with Docker, apply migrations, then exercise Auth/RLS, concurrent reservations, consent/versioning, payment callback verification, and staff role boundaries using test accounts and provider sandbox credentials. This repository does not contain a live-project integration test suite or provider credentials. Do not test payment or privileged RLS behavior against production customer data.

## Repository layout

```text
app/                    Expo Router auth, client, and operational screens
components/              Reusable mobile UI
features/                Auth, services, booking, appointments, CRM, and other APIs
hooks/                   Session and shared application hooks
lib/                     Supabase and query-client setup
supabase/migrations/     PostgreSQL schema, RLS, booking logic, and removable showcase seed
supabase/functions/      Trusted checkout, webhook, admin, showcase, expiry, and reminder handlers
types/                   Shared application types
```

## Operational notes and limitations

- Apply the migration and configure every required Auth redirect, Edge Function secret, payment-provider webhook, cron schedule, and EAS push credential before a production rollout.
- There is no live Supabase project in this repository configuration; RLS, PostgreSQL migration execution, Edge Functions, provider webhooks, and concurrent booking have not been integration-tested against a Supabase instance here.
- The Expo SDK 57 / NativeWind dependency audit still reports advisories, many with only breaking-version remediation suggested; resolve them before a production release.
- Online checkout cannot work until one gateway is configured. No test payment is fabricated by the client.
- Manual payments are recorded as `MANUAL`, not as a gateway payment. Refunds of paid cancellations require studio-side provider follow-up; automated refunds are not implemented.
- Before launch, have the studio enter verified services/prices/practitioners/schedules, consent wording, operating hours, and cancellation/rescheduling policy. Review consent, privacy, and payment behavior with appropriate business/legal professionals.
- Configure backup/restore, production monitoring, App Store/Play Store identifiers and signing, provider live mode, and a support/contact process before release.

## GitHub

Source repository: [mrsltycrml/Juana-bookingapp](https://github.com/mrsltycrml/Juana-bookingapp)
