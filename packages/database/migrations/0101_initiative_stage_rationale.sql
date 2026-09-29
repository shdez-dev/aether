ALTER TABLE initiatives
  ALTER COLUMN proposal_details SET DEFAULT '{
    "summary": "",
    "impactedPeople": "",
    "impactedCount": null,
    "problemImpact": "",
    "solution": "",
    "differentiation": "",
    "projectStage": "idea",
    "stageRationale": "",
    "pilotPlan": "",
    "pilotResources": ""
  }'::jsonb;

UPDATE initiatives
SET proposal_details = proposal_details || '{"stageRationale": ""}'::jsonb
WHERE NOT (proposal_details ? 'stageRationale');
