
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  telegram_username text,
  credit_balance bigint default 0,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text check (type in ('DIGITAL','CREDIT')),
  price bigint not null,
  description text,
  delivery_payload text,
  credit_amount bigint,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique,
  telegram_id bigint references users(telegram_id) on delete cascade,
  product_id uuid references products(id),
  amount bigint,
  status text check (status in ('PENDING','WAITING_APPROVAL','PAID','REJECTED')),
  created_at timestamptz default now()
);

create table if not exists payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  telegram_file_id text,
  created_at timestamptz default now()
);
