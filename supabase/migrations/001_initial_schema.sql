-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Clusters
create table clusters (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

-- Stores
create table stores (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  cluster_id uuid references clusters(id),
  monthly_limit numeric default 10000,
  created_at timestamptz default now()
);

-- Users (extends Supabase auth.users)
create table users (
  id uuid primary key references auth.users(id),
  name text not null,
  email text not null,
  role text check (role in ('store_manager','cluster_manager','accounting')) not null,
  store_id uuid references stores(id),
  cluster_id uuid references clusters(id),
  phone text,
  notification_preference text default 'email',
  created_at timestamptz default now()
);

-- Categories
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

insert into categories (name) values
  ('Cleaning'),('Stationery'),('Repairs'),
  ('Staff Welfare'),('Utilities'),('Miscellaneous');

-- Expenses
create table expenses (
  id uuid primary key default uuid_generate_v4(),
  store_id uuid references stores(id) not null,
  created_by uuid references users(id) not null,
  updated_by uuid references users(id),
  category_id uuid references categories(id) not null,
  amount numeric not null,
  description text,
  receipt_url text,
  expense_month date not null default date_trunc('month', now()),
  status text check (status in (
    'draft','submitted','cluster_approved','cluster_rejected',
    'accounting_approved','accounting_rejected','synced_to_tally','tally_sync_failed'
  )) default 'draft',
  cluster_approved_by uuid references users(id),
  accounting_approved_by uuid references users(id),
  rejection_reason text,
  tally_sync_status text,
  tally_voucher_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Audit logs
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  expense_id uuid references expenses(id),
  action text not null,
  performed_by uuid references users(id),
  remarks text,
  created_at timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger expenses_updated_at
  before update on expenses
  for each row execute function update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table users enable row level security;
alter table stores enable row level security;
alter table clusters enable row level security;
alter table expenses enable row level security;
alter table audit_logs enable row level security;
alter table categories enable row level security;

-- Helper function to get current user's role
create or replace function get_my_role()
returns text as $$
  select role from users where id = auth.uid();
$$ language sql security definer;

create or replace function get_my_store_id()
returns uuid as $$
  select store_id from users where id = auth.uid();
$$ language sql security definer;

create or replace function get_my_cluster_id()
returns uuid as $$
  select cluster_id from users where id = auth.uid();
$$ language sql security definer;

-- Categories: everyone can read
create policy "categories_read" on categories for select using (true);

-- Users: can see own profile; accounting sees all
create policy "users_own" on users for select using (auth.uid() = id);
create policy "users_accounting" on users for select using (get_my_role() = 'accounting');

-- Stores: store managers see own store; cluster managers see cluster stores; accounting sees all
create policy "stores_store_manager" on stores for select
  using (id = get_my_store_id());
create policy "stores_cluster_manager" on stores for select
  using (cluster_id = get_my_cluster_id() and get_my_role() = 'cluster_manager');
create policy "stores_accounting" on stores for select
  using (get_my_role() = 'accounting');

-- Expenses: store managers see own store only
create policy "expenses_store_manager_select" on expenses for select
  using (store_id = get_my_store_id() and get_my_role() = 'store_manager');
create policy "expenses_store_manager_insert" on expenses for insert
  with check (store_id = get_my_store_id() and get_my_role() = 'store_manager');
create policy "expenses_store_manager_update" on expenses for update
  using (store_id = get_my_store_id() and get_my_role() = 'store_manager' and status = 'draft');

-- Cluster managers see and can approve expenses in their cluster's stores
create policy "expenses_cluster_manager_select" on expenses for select
  using (
    get_my_role() = 'cluster_manager' and
    store_id in (select id from stores where cluster_id = get_my_cluster_id())
  );
create policy "expenses_cluster_manager_update" on expenses for update
  using (
    get_my_role() = 'cluster_manager' and
    store_id in (select id from stores where cluster_id = get_my_cluster_id()) and
    status = 'submitted'
  );

-- Accounting sees and can update everything
create policy "expenses_accounting_select" on expenses for select
  using (get_my_role() = 'accounting');
create policy "expenses_accounting_update" on expenses for update
  using (get_my_role() = 'accounting');

-- Audit logs: accounting sees all; others see own expense logs
create policy "audit_logs_accounting" on audit_logs for select
  using (get_my_role() = 'accounting');
create policy "audit_logs_own" on audit_logs for select
  using (expense_id in (select id from expenses where created_by = auth.uid()));
create policy "audit_logs_insert" on audit_logs for insert
  with check (auth.uid() is not null);
