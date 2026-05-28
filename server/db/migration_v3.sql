-- Migration v3: Multi-tenancy, RBAC, usage quotas, enhanced audit

-- ============================================================
-- ORGANIZATIONS ENHANCEMENTS
-- ============================================================

-- Add slug and settings to organizations
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS max_projects INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 25;

-- ============================================================
-- ORGANIZATION MEMBERS / RBAC
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ,
  invited_by UUID REFERENCES auth.users(id),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);

-- ============================================================
-- ROLE PERMISSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  permission TEXT NOT NULL,
  UNIQUE(role, permission)
);

-- Seed default permissions
INSERT INTO role_permissions (role, permission) VALUES
  ('owner', 'projects.create'), ('owner', 'projects.read'), ('owner', 'projects.update'), ('owner', 'projects.delete'),
  ('owner', 'members.invite'), ('owner', 'members.remove'), ('owner', 'members.update_role'),
  ('owner', 'billing.read'), ('owner', 'billing.update'),
  ('owner', 'alerts.create'), ('owner', 'alerts.read'), ('owner', 'alerts.update'), ('owner', 'alerts.delete'),
  ('owner', 'api_keys.create'), ('owner', 'api_keys.revoke'),
  ('owner', 'audit.read'),
  ('admin', 'projects.create'), ('admin', 'projects.read'), ('admin', 'projects.update'), ('admin', 'projects.delete'),
  ('admin', 'members.invite'), ('admin', 'members.remove'), ('admin', 'members.update_role'),
  ('admin', 'alerts.create'), ('admin', 'alerts.read'), ('admin', 'alerts.update'), ('admin', 'alerts.delete'),
  ('admin', 'api_keys.create'), ('admin', 'api_keys.revoke'),
  ('admin', 'audit.read'),
  ('member', 'projects.read'), ('member', 'projects.update'),
  ('member', 'alerts.read'), ('member', 'alerts.create'),
  ('member', 'api_keys.create'),
  ('viewer', 'projects.read'), ('viewer', 'alerts.read'), ('viewer', 'audit.read')
ON CONFLICT DO NOTHING;

-- ============================================================
-- USAGE QUOTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS usage_quotas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  requests_per_day INTEGER DEFAULT 50000,
  tokens_per_day INTEGER DEFAULT 10000000,
  requests_per_minute INTEGER DEFAULT 300,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id)
);

CREATE TABLE IF NOT EXISTS daily_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  requests_count INTEGER DEFAULT 0,
  tokens_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, date)
);

-- ============================================================
-- WEBHOOK RETRY LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID REFERENCES notification_settings(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'success', 'failed')),
  response_code INTEGER,
  response_body TEXT,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_retry ON webhook_deliveries(project_id, status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- ============================================================
-- ENHANCED AUDIT LOGS
-- ============================================================

ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS ip_address TEXT,
ADD COLUMN IF NOT EXISTS request_id UUID;

-- ============================================================
-- PROVIDER FAILOVER CONFIG
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_failover (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  primary_provider TEXT NOT NULL,
  fallback_providers TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, primary_provider)
);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Organization members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_select" ON organization_members;
CREATE POLICY "org_members_select" ON organization_members
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "org_members_insert" ON organization_members;
CREATE POLICY "org_members_insert" ON organization_members
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_members_delete" ON organization_members;
CREATE POLICY "org_members_delete" ON organization_members
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Usage quotas
ALTER TABLE usage_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_quotas_select" ON usage_quotas;
CREATE POLICY "usage_quotas_select" ON usage_quotas
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Daily usage
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_usage_select" ON daily_usage;
CREATE POLICY "daily_usage_select" ON daily_usage
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Webhook deliveries
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_deliveries_select" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_select" ON webhook_deliveries
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================
-- AUTO-CREATE ORGANIZATION MEMBER ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user_org()
RETURNS TRIGGER AS $$
BEGIN
  -- The existing trigger creates the organization; we add the owner membership
  INSERT INTO organization_members (organization_id, user_id, role, joined_at)
  SELECT id, NEW.id, 'owner', now()
  FROM organizations
  WHERE owner_user_id = NEW.id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_org_member ON auth.users;
CREATE TRIGGER on_auth_user_created_org_member
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_org();

-- ============================================================
-- AUTO-CREATE DEFAULT QUOTAS ON PROJECT CREATE
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_project_quota()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO usage_quotas (project_id)
  VALUES (NEW.id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_project_created_quota ON projects;
CREATE TRIGGER on_project_created_quota
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION handle_new_project_quota();
