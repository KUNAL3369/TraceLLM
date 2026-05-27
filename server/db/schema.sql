-- TraceLLM Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Organizations
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Projects
create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete cascade not null,
  name text not null,
  environment text not null default 'development' check (environment in ('development', 'staging', 'production')),
  created_at timestamptz default now()
);

-- API Keys
create table if not exists api_keys (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  key_hash text not null unique,
  label text default 'default',
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz default now(),
  last_used_at timestamptz
);

-- Conversations
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  session_id text,
  user_identifier text,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  started_at timestamptz default now(),
  last_activity_at timestamptz default now()
);

-- Messages
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content_preview text,
  token_count int default 0,
  created_at timestamptz default now()
);

-- Inference Logs
create table if not exists inference_logs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  conversation_id uuid references conversations(id) on delete set null,
  session_id text,
  provider text not null,
  model text not null,
  latency_ms int not null,
  prompt_tokens int default 0,
  completion_tokens int default 0,
  total_tokens int default 0,
  status text not null check (status in ('success', 'error')),
  error_type text,
  request_preview text,
  response_preview text,
  created_at timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_inference_logs_project_id on inference_logs(project_id);
create index if not exists idx_inference_logs_created_at on inference_logs(created_at desc);
create index if not exists idx_inference_logs_status on inference_logs(status);
create index if not exists idx_inference_logs_provider on inference_logs(provider);
create index if not exists idx_inference_logs_model on inference_logs(model);
create index if not exists idx_inference_logs_error_type on inference_logs(error_type);
create index if not exists idx_inference_logs_latency on inference_logs(latency_ms);
create index if not exists idx_inference_logs_tokens on inference_logs(total_tokens);
create index if not exists idx_inference_logs_conversation on inference_logs(conversation_id);
create index if not exists idx_inference_logs_project_created on inference_logs(project_id, created_at desc);
create index if not exists idx_conversations_project_id on conversations(project_id);
create index if not exists idx_conversations_status on conversations(status);
create index if not exists idx_api_keys_key_hash on api_keys(key_hash);
create index if not exists idx_organizations_owner on organizations(owner_user_id);
create index if not exists idx_projects_org on projects(organization_id);

-- Row Level Security
alter table organizations enable row level security;
alter table projects enable row level security;
alter table api_keys enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table inference_logs enable row level security;

-- RLS Policies
-- Organizations: users can see their own org
create policy "Users can view their own organization"
  on organizations for select
  using (owner_user_id = auth.uid());

-- Projects: users can see projects in their org
create policy "Users can view projects in their org"
  on projects for select
  using (
    organization_id in (
      select id from organizations where owner_user_id = auth.uid()
    )
  );

-- Conversations: users can view conversations in their projects
create policy "Users can view their conversations"
  on conversations for select
  using (
    project_id in (
      select p.id from projects p
      join organizations o on o.id = p.organization_id
      where o.owner_user_id = auth.uid()
    )
  );

-- Inference logs: users can view logs in their projects
create policy "Users can view their inference logs"
  on inference_logs for select
  using (
    project_id in (
      select p.id from projects p
      join organizations o on o.id = p.organization_id
      where o.owner_user_id = auth.uid()
    )
  );

-- Projects: users can create projects in their org
create policy "Users can create projects"
  on projects for insert
  with check (
    organization_id in (
      select id from organizations where owner_user_id = auth.uid()
    )
  );

-- API Keys: users can manage keys for their projects
create policy "Users can manage their API keys"
  on api_keys for all
  using (
    project_id in (
      select p.id from projects p
      join organizations o on o.id = p.organization_id
      where o.owner_user_id = auth.uid()
    )
  );

-- Auto-create organization on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.organizations (name, owner_user_id)
  values ('My Organization', new.id);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
