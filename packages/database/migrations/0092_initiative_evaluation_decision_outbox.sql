ALTER TABLE outbox_events
  DROP CONSTRAINT outbox_events_known_event_type_check;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_known_event_type_check
  CHECK (event_type IN (
    'document.scan_requested.v1',
    'initiative.evaluated.v1',
    'initiative.decided.v2',
    'project.created.v1',
    'project.created_from_initiative.v1',
    'project.status_changed.v1',
    'project.milestone_added.v1',
    'project.next_action_added.v1',
    'project.deliverable_accepted.v1',
    'project.closed.v1'
  ));
