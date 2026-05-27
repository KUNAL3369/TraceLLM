-- TraceLLM v2 Schema Migration
-- Run this after the base schema

-- PII Redaction toggle on projects
alter table projects add column if not exists pii_redaction_enabled boolean default false;

-- Alerts
create table if not exists alerts (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  alert_type text not null check (alert_type in ('latency_spike', 'error_rate_spike', 'token_burn_spike', 'provider_outage', 'throughput_drop')),
  threshold_value numeric not null,
  comparison_operator text not null default 'gt' check (comparison_operator in ('gt', 'lt', 'gte', 'lte')),
  time_window_minutes int not null default 5,
  is_active boolean not null default true,
  notification_channel text default 'email' check (notification_channel in ('email', 'slack', 'webhook', 'all')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Alert Events
create table if not exists alert_events (
  id uuid primary key default uuid_generate_v4(),
  alert_id uuid references alerts(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  triggered_value numeric not null,
  status text not null default 'triggered' check (status in ('triggered', 'resolved')),
  triggered_at timestamptz default now(),
  resolved_at timestamptz
);

-- Notification Settings
create table if not exists notification_settings (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null unique,
  slack_webhook_url text,
  email_enabled boolean default true,
  slack_enabled boolean default false,
  webhook_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Subscriptions
create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'growth')),
  status text not null default 'active' check (status in ('active', 'expired', 'canceled')),
  monthly_limit int not null default 1000,
  billing_period_start timestamptz not null default now(),
  billing_period_end timestamptz not null default (now() + interval '1 month'),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Usage Tracking
create table if not exists usage_tracking (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  request_count int not null default 0,
  token_count int not null default 0,
  cost_estimate numeric default 0,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz default now()
);

-- Audit Logs
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  action text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_alerts_project on alerts(project_id);
create index if not exists idx_alert_events_alert on alert_events(alert_id);
create index if not exists idx_alert_events_status on alert_events(status);
create index if not exists idx_alert_events_triggered on alert_events(triggered_at desc);
create index if not exists idx_notification_settings_project on notification_settings(project_id);
create index if not exists idx_subscriptions_org on subscriptions(organization_id);
create index if not exists idx_subscriptions_status on subscriptions(status);
create index if not exists idx_usage_tracking_project on usage_tracking(project_id);
create index if not exists idx_usage_tracking_period on usage_tracking(period_start, period_end);
create index if not exists idx_audit_logs_project on audit_logs(project_id);
create index if not exists idx_audit_logs_user on audit_logs(user_id);
create index if not exists idx_audit_logs_action on audit_logs(action);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- RLS
alter table alerts enable row level security;
alter table alert_events enable row level security;
alter table notification_settings enable row level security;
alter table subscriptions enable row level security;
alter table usage_tracking enable row level security;
alter table audit_logs enable row level security;

-- RLS Policies — scope by project ownership chain
create policy "Users can manage alerts for their projects"
  on alerts for all using (
    project_id in (select p.id from projects p join organizations o on o.id = p.organization_id where o.owner_user_id = auth.uid())
  );

create policy "Users can view alert events for their projects"
  on alert_events for select using (
    project_id in (select p.id from projects p join organizations o on o.id = p.organization_id where o.owner_user_id = auth.uid())
  );

create policy "Users can manage notification settings for their projects"
  on notification_settings for all using (
    project_id in (select p.id from projects p join organizations o on o.id = p.organization_id where o.owner_user_id = auth.uid())
  );

create policy "Users can view their subscription"
  on subscriptions for select using (
    organization_id in (select id from organizations where owner_user_id = auth.uid())
  );

create policy "Users can view usage for their projects"
  on usage_tracking for select using (
    project_id in (select p.id from projects p join organizations o on o.id = p.organization_id where o.owner_user_id = auth.uid())
  );

create policy "Users can view audit logs for their projects"
  on audit_logs for select using (
    project_id in (select p.id from projects p join organizations o on o.id = p.organization_id where o.owner_user_id = auth.uid())
  );

-- Auto-create free subscription on org creation
create or replace function public.handle_new_organization()
returns trigger as $$
begin
  insert into public.subscriptions (organization_id, plan, monthly_limit, billing_period_start, billing_period_end)
  values (new.id, 'free', 1000, now(), now() + interval '1 month');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_organization_created
  after insert on organizations
  for each row execute procedure public.handle_new_organization();
