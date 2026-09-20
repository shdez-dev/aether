CREATE TABLE capacity_availabilities (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('hours', 'days', 'points')),
  period_starts_on DATE NOT NULL,
  period_ends_on DATE NOT NULL,
  available_effort NUMERIC(12, 2) NOT NULL CHECK (available_effort > 0),
  declared_by_actor_id TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL,
  CHECK (period_starts_on <= period_ends_on),
  UNIQUE (organization_id, actor_id, unit, period_starts_on, period_ends_on)
);

CREATE TABLE capacity_allocations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  actor_id TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('hours', 'days', 'points')),
  period_starts_on DATE NOT NULL,
  period_ends_on DATE NOT NULL,
  allocated_effort NUMERIC(12, 2) NOT NULL CHECK (allocated_effort > 0),
  declared_by_actor_id TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL,
  CHECK (period_starts_on <= period_ends_on)
);

CREATE INDEX capacity_allocations_balance_idx
  ON capacity_allocations (
    organization_id,
    actor_id,
    unit,
    period_starts_on,
    period_ends_on
  );

CREATE OR REPLACE FUNCTION validate_capacity_availability_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM organization_memberships available_member
      JOIN organization_memberships declarer
        ON declarer.organization_id = available_member.organization_id
     WHERE available_member.organization_id = NEW.organization_id
       AND available_member.actor_id = NEW.actor_id
       AND available_member.status = 'active'
       AND declarer.actor_id = NEW.declared_by_actor_id
       AND declarer.status = 'active'
       AND declarer.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'capacity availability requires active organization members'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capacity_availabilities_scope_check
BEFORE INSERT OR UPDATE
ON capacity_availabilities
FOR EACH ROW EXECUTE FUNCTION validate_capacity_availability_scope();

CREATE OR REPLACE FUNCTION validate_capacity_allocation_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships allocated_member
        ON allocated_member.organization_id = project.organization_id
      JOIN organization_memberships declarer
        ON declarer.organization_id = project.organization_id
      JOIN workspace_memberships workspace_member
        ON workspace_member.workspace_id = project.workspace_id
     WHERE project.id = NEW.project_id
       AND project.organization_id = NEW.organization_id
       AND project.workspace_id = NEW.workspace_id
       AND allocated_member.actor_id = NEW.actor_id
       AND allocated_member.status = 'active'
       AND declarer.actor_id = NEW.declared_by_actor_id
       AND declarer.status = 'active'
       AND declarer.role IN ('owner', 'admin')
       AND workspace_member.actor_id = NEW.actor_id
       AND project.participants @> jsonb_build_array(
         jsonb_build_object('actorId', NEW.actor_id)
       )
  ) THEN
    RAISE EXCEPTION 'capacity allocation must preserve project and membership scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capacity_allocations_scope_check
BEFORE INSERT OR UPDATE
ON capacity_allocations
FOR EACH ROW EXECUTE FUNCTION validate_capacity_allocation_scope();
