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
  role text not null default 'Crew'
);

alter table public.green_grin_employees
  add column if not exists employee_code text;

alter table public.green_grin_employees
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.green_grin_employees
  add column if not exists employee_pin text;

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

create index if not exists green_grin_invoices_customer_user_idx
  on public.green_grin_invoices(customer_user_id);

create index if not exists green_grin_invoices_customer_code_idx
  on public.green_grin_invoices(customer_code);

create index if not exists green_grin_invoices_status_idx
  on public.green_grin_invoices(status);

notify pgrst, 'reload schema';
