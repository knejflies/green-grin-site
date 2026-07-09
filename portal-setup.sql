create extension if not exists pgcrypto;

create table if not exists public.green_grin_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  phone text not null,
  email text,
  address text,
  service_type text,
  preferred_date date,
  scheduled_date timestamptz,
  status text not null default 'New',
  notes text,
  last_message_template text,
  last_message_sent_at timestamptz,
  last_cleanup_reminder_sent_at timestamptz
);

alter table public.green_grin_jobs
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;

alter table public.green_grin_jobs
  add column if not exists last_cleanup_reminder_sent_at timestamptz;

create table if not exists public.green_grin_customers (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  full_name text,
  phone text,
  email text,
  billing_plan text,
  billing_status text not null default 'Not connected',
  monthly_price numeric(10, 2),
  stripe_customer_id text,
  gocardless_customer_id text
);

create table if not exists public.green_grin_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  address text,
  gate_code text,
  pets text,
  yard_notes text,
  service_preferences text,
  active boolean not null default true
);

create table if not exists public.green_grin_employees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null unique,
  phone text,
  status text not null default 'Pending',
  employee_pin text,
  role text not null default 'Crew'
);

alter table public.green_grin_employees
  add column if not exists employee_pin text;

create table if not exists public.green_grin_message_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid references public.green_grin_jobs(id) on delete set null,
  phone text not null,
  template text not null,
  message text not null,
  actor_type text,
  actor_name text,
  actor_employee_id uuid references public.green_grin_employees(id) on delete set null,
  twilio_sid text
);

alter table public.green_grin_message_log
  add column if not exists actor_type text;

alter table public.green_grin_message_log
  add column if not exists actor_name text;

alter table public.green_grin_message_log
  add column if not exists actor_employee_id uuid references public.green_grin_employees(id) on delete set null;

alter table public.green_grin_customers enable row level security;
alter table public.green_grin_properties enable row level security;
alter table public.green_grin_employees enable row level security;

drop policy if exists "Customers can read own profile" on public.green_grin_customers;
drop policy if exists "Customers can insert own profile" on public.green_grin_customers;
drop policy if exists "Customers can update own profile" on public.green_grin_customers;
drop policy if exists "Customers can read own properties" on public.green_grin_properties;
drop policy if exists "Customers can insert own properties" on public.green_grin_properties;
drop policy if exists "Customers can update own properties" on public.green_grin_properties;
drop policy if exists "Employees can read own employee profile" on public.green_grin_employees;

create policy "Customers can read own profile"
  on public.green_grin_customers for select
  using (auth.uid() = id);

create policy "Customers can insert own profile"
  on public.green_grin_customers for insert
  with check (auth.uid() = id);

create policy "Customers can update own profile"
  on public.green_grin_customers for update
  using (auth.uid() = id);

create policy "Customers can read own properties"
  on public.green_grin_properties for select
  using (auth.uid() = customer_user_id);

create policy "Customers can insert own properties"
  on public.green_grin_properties for insert
  with check (auth.uid() = customer_user_id);

create policy "Customers can update own properties"
  on public.green_grin_properties for update
  using (auth.uid() = customer_user_id);

create policy "Employees can read own employee profile"
  on public.green_grin_employees for select
  using (auth.uid() = user_id);

create index if not exists green_grin_jobs_phone_idx on public.green_grin_jobs(phone);
create index if not exists green_grin_jobs_customer_user_idx on public.green_grin_jobs(customer_user_id);
create index if not exists green_grin_jobs_created_at_idx on public.green_grin_jobs(created_at desc);
create index if not exists green_grin_jobs_scheduled_date_idx on public.green_grin_jobs(scheduled_date);
create index if not exists green_grin_properties_customer_user_idx on public.green_grin_properties(customer_user_id);
create index if not exists green_grin_employees_user_id_idx on public.green_grin_employees(user_id);
create index if not exists green_grin_employees_email_idx on public.green_grin_employees(email);
create index if not exists green_grin_employees_status_idx on public.green_grin_employees(status);
create index if not exists green_grin_employees_pin_idx on public.green_grin_employees(employee_pin);
create index if not exists green_grin_message_log_created_at_idx on public.green_grin_message_log(created_at desc);
