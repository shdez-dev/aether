ALTER TABLE evidence_references
  DROP CONSTRAINT evidence_references_subject_type_check;
ALTER TABLE evidence_references
  ADD CONSTRAINT evidence_references_subject_type_check
  CHECK (subject_type IN ('initiative', 'evaluation', 'decision', 'project', 'project_closure'));
