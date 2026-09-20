ALTER TABLE project_next_actions
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  ADD COLUMN estimated_effort NUMERIC(12, 2) NULL,
  ADD COLUMN effort_unit TEXT NULL
    CHECK (effort_unit IN ('hours', 'days', 'points')),
  ADD COLUMN period_start_on DATE NULL,
  ADD COLUMN period_end_on DATE NULL,
  ADD CONSTRAINT project_next_actions_estimation_complete
    CHECK (
      (estimated_effort IS NULL AND effort_unit IS NULL)
      OR (estimated_effort > 0 AND effort_unit IS NOT NULL)
    ),
  ADD CONSTRAINT project_next_actions_period_complete
    CHECK (
      (period_start_on IS NULL AND period_end_on IS NULL)
      OR (
        period_start_on IS NOT NULL
        AND period_end_on IS NOT NULL
        AND period_start_on <= period_end_on
      )
    );

COMMENT ON COLUMN project_next_actions.estimated_effort IS
  'Estimación explícita; NULL representa esfuerzo desconocido y no cero.';
COMMENT ON COLUMN project_next_actions.effort_unit IS
  'Unidad de la estimación: horas, días o puntos.';
COMMENT ON COLUMN project_next_actions.period_start_on IS
  'Inicio del período operativo declarado para la acción.';
COMMENT ON COLUMN project_next_actions.period_end_on IS
  'Término del período operativo declarado para la acción.';
