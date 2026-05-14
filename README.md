# VS Corp Petty Cash Tracker — Project Handoff

## Status: Core flow working ✅

The full approval chain is live and tested:
```
Store Manager submits expense + receipt
        ↓ status: submitted
Cluster Manager approves (Approvals page)
        ↓ status: cluster_approved
Admin / Accounting final approves (Approvals page)
        ↓ status: accounting_approved
[ Tally sync — placeholder, API pending ]
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database + Auth | Supabase |
| File Storage | Supabase Storage (bucket: `receipts`, public) |
| Styling | Tailwind CSS |
| Forms | react-hook-form + zod |
| Hosting | Not yet deployed (running locally on port 3000) |

---

## Supabase Project

- **URL:** https://dxzqmszzthylarjtrgwd.supabase.co
- **Env file:** `.env.local` (already configured, do not commit to git)
- **Keys needed:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Database Schema

### Tables (all created and live)
- `clusters` — 2 rows (Cluster A, Cluster B)
- `stores` — 20 rows (Store 01–20, ₹10,000/month limit each)
- `users` — extends `auth.users`, has role/store/cluster foreign keys
- `categories` — 6 rows (Cleaning, Stationery, Repairs, Staff Welfare, Utilities, Miscellaneous)
- `expenses` — main table, has status workflow + receipt_url + tally fields
- `audit_logs` — every status change logged here

### Expense statuses
```
draft → submitted → cluster_approved → accounting_approved → synced_to_tally
                 ↘ cluster_rejected
                                    ↘ accounting_rejected
                                                          ↘ tally_sync_failed
```

### RLS
All tables have Row Level Security enabled. Key rules:
- Store managers: see/edit only their own store's expenses
- Cluster managers: see/approve only their cluster's expenses
- Accounting: full read/update access on all expenses

---

## Roles

| Role | Email (test) | Password | Access |
|---|---|---|---|
| Store Manager | store01@vscorp.com | Test@1234 | Submit expenses, view own store |
| Cluster Manager | cluster.a@vscorp.com | Test@1234 | Approve submitted expenses for Cluster A |
| Admin / Accounting | admin@vscorp.com | Test@1234 | Final approval, all stores, reports |

---

## Project Structure

```
app/
  (auth)/login/         — Login page (Supabase email/password auth)
  (dashboard)/
    page.tsx            — Dashboard (role-specific stats)
    layout.tsx          — Sidebar + Header wrapper
    expenses/
      page.tsx          — Expense list with filters
      new/page.tsx      — New expense form
      [id]/page.tsx     — Expense detail view
    approvals/page.tsx  — Approval queue (cluster + accounting)
    reports/page.tsx    — Reports (accounting only)

components/
  layout/
    Sidebar.tsx         — Desktop sidebar + mobile drawer, role-based nav
    Header.tsx          — Top bar with user avatar + logout button
  dashboard/
    StatsCards.tsx      — Role-specific stat cards (all 3 roles implemented)
    RecentExpenses.tsx  — Recent expenses list for store manager
  expenses/
    ExpenseForm.tsx     — New expense form (category, amount, description, receipt)
    ExpenseCard.tsx     — Expense card component
    ExpenseTable.tsx    — Expense table with filters
    ReceiptUpload.tsx   — Drag/drop + camera upload to Supabase Storage
  approvals/
    ApprovalActions.tsx — Approve/Reject buttons with rejection reason modal
  ui/
    Badge.tsx, Button.tsx, Card.tsx, Modal.tsx

lib/
  supabase/
    client.ts           — Browser Supabase client
    server.ts           — Server-side Supabase client
  hooks/
    useAuth.ts          — Auth state + signOut (redirects to /login)
    useExpenses.ts      — Fetch expenses with filters
    useApprovals.ts     — Fetch pending approvals + approve/reject actions
  utils/
    cn.ts               — Tailwind class merge utility
    formatCurrency.ts   — INR formatter
```

---

## What's Working ✅

- Login / logout (Supabase Auth, email + password)
- Role-based routing and UI (store_manager / cluster_manager / accounting)
- Store manager: submit expenses (draft or direct submit), receipt photo upload
- Cluster manager: approve/reject submitted expenses
- Accounting: final approve/reject cluster-approved expenses
- Audit log: every action recorded
- Receipt upload: Supabase Storage, public bucket, 5MB limit
- Mobile responsive: sidebar drawer on mobile, desktop sidebar on desktop
- Budget warning: shows alert if expense would exceed monthly limit

---

## What's NOT Done Yet ❌

### 1. Tally Integration (most important)
- Client to provide: API endpoint, auth method, required fields per voucher
- Create: `lib/tally.ts` and `app/api/tally/sync/route.ts`
- Trigger: after `accounting_approved`, call Tally API, update status to `synced_to_tally` or `tally_sync_failed`

```ts
// Tally payload shape (confirm with client's API docs)
{
  voucher_type: "Payment",
  date: expense.date,
  amount: expense.amount,
  narration: `${category} - ${description}`,
  store: expense.store.name,
  ledger: CATEGORY_TO_LEDGER_MAP[expense.category],
  reference: expense.id,
}
```

### 2. Reports Page
- `app/(dashboard)/reports/page.tsx` exists but likely placeholder
- Needs: month-wise summary, store-wise breakdown, category-wise breakdown, export to Excel/PDF

### 3. Notifications
- Client prefers WhatsApp (India, retail context)
- Triggers: store submits → notify cluster manager; cluster approves → notify accounting

### 4. Deploy to Vercel
- Run `npm run build` and fix any build errors first
- Connect GitHub repo to Vercel, add env vars, deploy

### 5. Create remaining store users
- Currently only store01@vscorp.com exists
- Need auth users + users table rows for all 20 store managers + Cluster B manager

---

## How to Run Locally

```bash
cd /d/Petty-cash-system/petty-cash-app
npm run dev
# Open http://localhost:3000
```

---

## Known Issues / Watch Out For

- Next.js 16 has breaking changes — always read `node_modules/next/dist/docs/` before writing new route handlers
- `middleware.ts` is deprecated in this version — use `proxy.ts` instead (already in place)
- RLS on `users` table: always filter by `.eq('id', authUser.id)` explicitly when fetching user profile — `.single()` without it returns null
- Receipt upload: bucket is `receipts`, public. Max 5MB, JPG/PNG/WebP/PDF only
- Monthly limit stored in `stores.monthly_limit`. Default 10000. No UI to change it yet — edit via Supabase Table Editor

---

## Next Session Priorities (in order)

1. Get Tally API docs from client → build sync function
2. Fix/verify reports page
3. Create all 20 store manager accounts
4. Test on mobile (store managers use phones)
5. Deploy to Vercel