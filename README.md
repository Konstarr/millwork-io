# millwork.io

Multi-tenant millwork estimating tool. React + Vite + Supabase.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

Then open http://localhost:5173.

## Modules

- **Customers** — customer database (companies + contacts)
- **Projects** — jobs tied to customers, each with one or more estimates
- **Estimating** — line-item estimates that pull from materials + labor
- **Materials** — the material library (SKUs, unit costs, waste factors)
- **Labor** — labor categories, shop rates, and burden settings

## Multi-tenant model

Every user belongs to one or more **orgs** (a company workspace).
All data is scoped by `org_id` and gated by Supabase RLS.
Switch orgs from the top bar.

## Database

Migrations live in `supabase/migrations/` and are applied automatically by the
`.github/workflows/deploy-supabase.yml` GitHub Action every time you push to
`main`. The action calls `supabase db push` after linking to the project via
the `SUPABASE_PROJECT_ID` secret.

**One-time GitHub setup** (Settings → Secrets and variables → Actions):

| Secret                    | Where to get it                                                      |
|---------------------------|----------------------------------------------------------------------|
| `SUPABASE_ACCESS_TOKEN`   | supabase.com → Account → Access Tokens → Generate new                |
| `SUPABASE_PROJECT_ID`     | Your project ref (`abcdefghijklmno`) from Project Settings → General |
| `SUPABASE_DB_PASSWORD`    | Project Settings → Database → password you set at project creation   |

To apply migrations locally instead: `supabase link --project-ref <REF> && supabase db push`.

**First run** applies `20260731170000_reset_public_schema.sql`, which drops
every table + function in `public.*`. This is intentional — the Supabase
project used to host a previous app. Auth users survive; they just have to
go through `/onboarding` to create a workspace.

## Layout

```
src/
  main.jsx              app entry
  App.jsx               router
  lib/supabase.js       supabase client
  context/              AuthContext, OrgContext
  components/           auth guards, layout (Sidebar, TopBar, AppShell)
  pages/                Login, Signup, Dashboard, OrgOnboarding
  pages/customers/      customer list + detail
  pages/projects/       project list + detail
  pages/estimates/      estimate list + detail
  pages/materials/      material library
  pages/labor/          labor settings
  styles/global.css     app-wide CSS
```
