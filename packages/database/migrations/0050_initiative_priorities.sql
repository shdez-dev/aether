ALTER TABLE initiatives
  ADD COLUMN requested_priority TEXT NULL
    CHECK (requested_priority IN ('low', 'medium', 'high')),
  ADD COLUMN operational_priority TEXT NULL
    CHECK (operational_priority IN ('low', 'medium', 'high'));

COMMENT ON COLUMN initiatives.requested_priority IS
  'Prioridad declarada al presentar la necesidad; no representa el orden institucional.';
COMMENT ON COLUMN initiatives.operational_priority IS
  'Prioridad asignada por gestión institucional, independiente de la solicitud.';
