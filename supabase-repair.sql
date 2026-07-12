create extension if not exists pgcrypto;

create table if not exists public.green_grin_counters (
  name text primary key,
  last_value integer not null default 0
);

insert into public.green_grin_counters (name, last_value)
values ('customer_code', 0), ('employee_code', 0)
on conflict (name) do nothing;

create table if not exists public.green_grin_customers (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  customer_code text unique,
  full_name text,
  phone text,
  email text,
  active boolean not null default true,
  billing_plan text,
  billing_status text not null default 'Not connected',
  monthly_price numeric(10, 2),
  annual_price numeric(10, 2),
  text_cleanup_reminders boolean not null default true,
  text_done_messages boolean not null default true,
  email_monthly_receipts boolean not null default false,
  stripe_customer_id text,
  gocardless_customer_id text
);

alter table public.green_grin_customers
  add column if not exists customer_code text;

alter table public.green_grin_customers
  add column if not exists full_name text;

alter table public.green_grin_customers
  add column if not exists phone text;

alter table public.green_grin_customers
  add column if not exists email text;

alter table public.green_grin_customers
  add column if not exists active boolean not null default true;

alter table public.green_grin_customers
  add column if not exists billing_plan text;

alter table public.green_grin_customers
  add column if not exists billing_status text not null default 'Not connected';

alter table public.green_grin_customers
  add column if not exists monthly_price numeric(10, 2);

alter table public.green_grin_customers
  add column if not exists annual_price numeric(10, 2);

alter table public.green_grin_customers
  add column if not exists text_cleanup_reminders boolean not null default true;

alter table public.green_grin_customers
  add column if not exists text_done_messages boolean not null default true;

alter table public.green_grin_customers
  add column if not exists email_monthly_receipts boolean not null default false;

alter table public.green_grin_customers
  add column if not exists stripe_customer_id text;

alter table public.green_grin_customers
  add column if not exists gocardless_customer_id text;

create table if not exists public.green_grin_employees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_code text unique,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null unique,
  phone text,
  status text not null default 'Pending',
  employee_pin text,
  hourly_rate numeric(10, 2),
  role text not null default 'Crew'
);

alter table public.green_grin_employees
  add column if not exists employee_code text;

alter table public.green_grin_employees
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.green_grin_employees
  add column if not exists employee_pin text;

alter table public.green_grin_employees
  add column if not exists hourly_rate numeric(10, 2);

create table if not exists public.green_grin_time_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employee_id uuid not null references public.green_grin_employees(id) on delete cascade,
  employee_code text,
  employee_name text,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  total_minutes integer,
  hourly_rate numeric(10, 2),
  gross_pay numeric(10, 2),
  notes text
);

alter table public.green_grin_time_entries
  add column if not exists employee_code text;

alter table public.green_grin_time_entries
  add column if not exists employee_name text;

alter table public.green_grin_time_entries
  add column if not exists clock_out_at timestamptz;

alter table public.green_grin_time_entries
  add column if not exists total_minutes integer;

alter table public.green_grin_time_entries
  add column if not exists hourly_rate numeric(10, 2);

alter table public.green_grin_time_entries
  add column if not exists gross_pay numeric(10, 2);

alter table public.green_grin_time_entries
  add column if not exists notes text;

alter table public.green_grin_jobs
  add column if not exists assigned_employee_id uuid references public.green_grin_employees(id) on delete set null;

alter table public.green_grin_jobs
  add column if not exists assigned_employee_name text;

create table if not exists public.green_grin_invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_user_id uuid references auth.users(id) on delete cascade,
  customer_code text,
  customer_name text not null,
  phone text,
  email text,
  amount numeric(10, 2) not null default 0,
  due_date date,
  status text not null default 'Draft',
  service_line text,
  notes text,
  payment_url text,
  active boolean not null default true
);

alter table public.green_grin_invoices
  add column if not exists customer_user_id uuid references auth.users(id) on delete cascade;

alter table public.green_grin_invoices
  add column if not exists customer_code text;

alter table public.green_grin_invoices
  add column if not exists phone text;

alter table public.green_grin_invoices
  add column if not exists email text;

alter table public.green_grin_invoices
  add column if not exists service_line text;

alter table public.green_grin_invoices
  add column if not exists payment_url text;

alter table public.green_grin_invoices
  add column if not exists active boolean not null default true;

create table if not exists public.green_grin_expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expense_type text not null default 'receipt',
  expense_date date not null default current_date,
  vendor text not null default '',
  category text not null default 'Other',
  amount numeric(10, 2) not null default 0,
  subtotal numeric(10, 2),
  tax numeric(10, 2),
  payment_method text,
  notes text,
  receipt_filename text,
  mileage_start numeric(12, 2),
  mileage_end numeric(12, 2),
  mileage_miles numeric(10, 2),
  mileage_rate numeric(10, 2),
  ai_confidence numeric(4, 2),
  ai_raw jsonb,
  active boolean not null default true
);

alter table public.green_grin_expenses
  add column if not exists expense_type text not null default 'receipt';

alter table public.green_grin_expenses
  add column if not exists expense_date date not null default current_date;

alter table public.green_grin_expenses
  add column if not exists vendor text not null default '';

alter table public.green_grin_expenses
  add column if not exists category text not null default 'Other';

alter table public.green_grin_expenses
  add column if not exists amount numeric(10, 2) not null default 0;

alter table public.green_grin_expenses
  add column if not exists subtotal numeric(10, 2);

alter table public.green_grin_expenses
  add column if not exists tax numeric(10, 2);

alter table public.green_grin_expenses
  add column if not exists payment_method text;

alter table public.green_grin_expenses
  add column if not exists notes text;

alter table public.green_grin_expenses
  add column if not exists receipt_filename text;

alter table public.green_grin_expenses
  add column if not exists mileage_start numeric(12, 2);

alter table public.green_grin_expenses
  add column if not exists mileage_end numeric(12, 2);

alter table public.green_grin_expenses
  add column if not exists mileage_miles numeric(10, 2);

alter table public.green_grin_expenses
  add column if not exists mileage_rate numeric(10, 2);

alter table public.green_grin_expenses
  add column if not exists ai_confidence numeric(4, 2);

alter table public.green_grin_expenses
  add column if not exists ai_raw jsonb;

alter table public.green_grin_expenses
  add column if not exists active boolean not null default true;

alter table public.green_grin_expenses enable row level security;

create index if not exists green_grin_jobs_assigned_employee_idx
  on public.green_grin_jobs(assigned_employee_id);

create index if not exists green_grin_customers_customer_code_idx
  on public.green_grin_customers(customer_code);

create index if not exists green_grin_customers_email_idx
  on public.green_grin_customers(email);

create index if not exists green_grin_customers_phone_idx
  on public.green_grin_customers(phone);

create index if not exists green_grin_employees_employee_code_idx
  on public.green_grin_employees(employee_code);

create index if not exists green_grin_employees_email_idx
  on public.green_grin_employees(email);

create index if not exists green_grin_employees_status_idx
  on public.green_grin_employees(status);

create index if not exists green_grin_time_entries_employee_idx
  on public.green_grin_time_entries(employee_id);

create index if not exists green_grin_time_entries_clock_in_idx
  on public.green_grin_time_entries(clock_in_at desc);

create index if not exists green_grin_time_entries_open_idx
  on public.green_grin_time_entries(employee_id)
  where clock_out_at is null;

alter table public.green_grin_time_entries enable row level security;

drop policy if exists "Employees can read own time entries" on public.green_grin_time_entries;

create policy "Employees can read own time entries"
  on public.green_grin_time_entries for select
  using (
    exists (
      select 1
      from public.green_grin_employees
      where green_grin_employees.id = green_grin_time_entries.employee_id
        and green_grin_employees.user_id = auth.uid()
    )
  );

create index if not exists green_grin_invoices_customer_user_idx
  on public.green_grin_invoices(customer_user_id);

create index if not exists green_grin_invoices_customer_code_idx
  on public.green_grin_invoices(customer_code);

create index if not exists green_grin_invoices_status_idx
  on public.green_grin_invoices(status);

create index if not exists green_grin_expenses_date_idx
  on public.green_grin_expenses(expense_date);

create index if not exists green_grin_expenses_category_idx
  on public.green_grin_expenses(category);

create index if not exists green_grin_expenses_active_idx
  on public.green_grin_expenses(active);

create index if not exists green_grin_expenses_type_idx
  on public.green_grin_expenses(expense_type);

create table if not exists public.green_grin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  owner_type text not null default 'customer',
  owner_email text,
  customer_user_id uuid references auth.users(id) on delete cascade,
  customer_code text,
  employee_id uuid references public.green_grin_employees(id) on delete cascade,
  employee_code text,
  user_agent text,
  active boolean not null default true
);

alter table public.green_grin_push_subscriptions
  add column if not exists updated_at timestamptz not null default now();

alter table public.green_grin_push_subscriptions
  add column if not exists owner_type text not null default 'customer';

alter table public.green_grin_push_subscriptions
  add column if not exists owner_email text;

alter table public.green_grin_push_subscriptions
  add column if not exists customer_user_id uuid references auth.users(id) on delete cascade;

alter table public.green_grin_push_subscriptions
  add column if not exists customer_code text;

alter table public.green_grin_push_subscriptions
  add column if not exists employee_id uuid references public.green_grin_employees(id) on delete cascade;

alter table public.green_grin_push_subscriptions
  add column if not exists employee_code text;

alter table public.green_grin_push_subscriptions
  add column if not exists user_agent text;

alter table public.green_grin_push_subscriptions
  add column if not exists active boolean not null default true;

alter table public.green_grin_push_subscriptions enable row level security;

create index if not exists green_grin_push_subscriptions_owner_type_idx
  on public.green_grin_push_subscriptions(owner_type);

create index if not exists green_grin_push_subscriptions_customer_user_idx
  on public.green_grin_push_subscriptions(customer_user_id);

create index if not exists green_grin_push_subscriptions_customer_code_idx
  on public.green_grin_push_subscriptions(customer_code);

create index if not exists green_grin_push_subscriptions_employee_idx
  on public.green_grin_push_subscriptions(employee_id);

create index if not exists green_grin_push_subscriptions_active_idx
  on public.green_grin_push_subscriptions(active);

notify pgrst, 'reload schema';
