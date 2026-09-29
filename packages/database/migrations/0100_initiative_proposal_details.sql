ALTER TABLE initiatives
  ADD COLUMN proposal_details JSONB NOT NULL DEFAULT '{
    "summary": "",
    "impactedPeople": "",
    "impactedCount": null,
    "problemImpact": "",
    "solution": "",
    "differentiation": "",
    "projectStage": "idea",
    "pilotPlan": "",
    "pilotResources": ""
  }'::jsonb;
