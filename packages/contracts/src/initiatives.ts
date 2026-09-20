import { z } from "zod";

import { NonEmptyTextSchema, UuidSchema } from "./common.js";

export const InitiativeStatusSchema = z.enum([
  "draft",
  "presented",
  "under_review",
  "returned",
  "approved",
  "rejected",
  "cancelled",
]);
export const InitiativePrioritySchema = z.enum(["low", "medium", "high"]);

export const CreateInitiativeDraftRequestSchema = z.object({
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  title: NonEmptyTextSchema.max(255),
  problemStatement: NonEmptyTextSchema.max(10_000),
  expectedOutcome: NonEmptyTextSchema.max(10_000),
  classification: z.enum(["internal", "confidential"]),
  requestedPriority: InitiativePrioritySchema,
});

export const SetInitiativeOperationalPriorityRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  operationalPriority: InitiativePrioritySchema,
});

export const SubmitInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const UpdateInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: NonEmptyTextSchema.max(255),
  problemStatement: NonEmptyTextSchema.max(10_000),
  expectedOutcome: NonEmptyTextSchema.max(10_000),
  classification: z.enum(["internal", "confidential"]),
});

export const StartReviewRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  standardId: UuidSchema,
  results: z
    .array(
      z.object({
        criterionId: UuidSchema,
        assessment: z.enum(["met", "not_met", "not_applicable"]).nullable(),
        evidence: z.array(NonEmptyTextSchema.max(2_000)).max(50),
      }),
    )
    .max(100),
});
export const AnnulEvaluationRequestSchema = z.object({
  organizationId: UuidSchema,
  reason: NonEmptyTextSchema.max(2_000),
});
export const AssignEvaluationReviewerRequestSchema = z.object({
  organizationId: UuidSchema,
  reviewerActorId: z.string().min(1).max(255),
});
export const AbstainFromEvaluationReviewRequestSchema = z.object({
  organizationId: UuidSchema,
  reason: NonEmptyTextSchema.max(2_000),
});
export const ReassignEvaluationReviewRequestSchema = z.object({
  organizationId: UuidSchema,
  reviewerActorId: z.string().min(1).max(255),
  reason: NonEmptyTextSchema.max(2_000),
});
export const EscalateEvaluationReviewAbstentionRequestSchema = z.object({
  organizationId: UuidSchema,
  reason: NonEmptyTextSchema.max(2_000),
});

export const DecisionConditionInputSchema = z.object({
  description: NonEmptyTextSchema.max(2_000),
  responsibleActorId: z.string().min(1).max(255),
  dueOn: z.string().date(),
});
export const DecideInitiativeRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    evaluationId: UuidSchema,
    outcome: z.enum(["approved", "rejected", "returned", "cancelled"]),
    rationale: NonEmptyTextSchema.max(10_000),
    evidence: z.array(NonEmptyTextSchema.max(2_000)).max(50),
    nextReviewOn: z.string().date().nullable().optional(),
    conditions: z.array(DecisionConditionInputSchema).max(50).optional(),
  })
  .superRefine((value, context) => {
    if (value.outcome !== "approved" && (value.conditions?.length ?? 0) > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: "Conditions are only allowed for approved decisions",
      });
    if (value.outcome === "returned" && !value.nextReviewOn)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextReviewOn"],
        message: "Returned decisions require a next review date",
      });
    if (value.outcome !== "returned" && value.nextReviewOn)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextReviewOn"],
        message: "A next review date is only allowed for returned decisions",
      });
  });
export const ExemptDecisionConditionRequestSchema = z.object({
  reason: NonEmptyTextSchema.max(2_000),
});
export const FulfillDecisionConditionRequestSchema = z.object({
  note: NonEmptyTextSchema.max(2_000),
});

export const EvaluationCriterionInputSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(64),
  name: NonEmptyTextSchema.max(255),
  description: NonEmptyTextSchema.max(2_000),
  weight: z.number().positive().max(1_000),
});
export const PublishEvaluationStandardRequestSchema = z.object({
  organizationId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  version: z.number().int().positive(),
  criteria: z.array(EvaluationCriterionInputSchema).min(1).max(100),
});
export const TriageCriterionInputSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(64),
  name: NonEmptyTextSchema.max(255),
  description: NonEmptyTextSchema.max(2_000),
  required: z.boolean(),
});
export const PublishTriageStandardRequestSchema = z.object({
  organizationId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  version: z.number().int().positive(),
  criteria: z.array(TriageCriterionInputSchema).min(1).max(100),
});
export const ActivateTriageStandardRequestSchema = z.object({
  organizationId: UuidSchema,
});
export const TriageInitiativeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  standardId: UuidSchema,
  results: z
    .array(
      z.object({
        criterionId: UuidSchema,
        assessment: z.enum(["pass", "fail", "not_applicable"]).nullable(),
        justification: z.array(NonEmptyTextSchema.max(2_000)).max(50),
      }),
    )
    .max(100),
});
export const AssignIntakeResponsibilityRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  responsibleActorId: z.string().min(1).max(255),
  nextReviewOn: z.string().date(),
});
export const DeclareInitiativeRelationshipRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  targetInitiativeId: UuidSchema,
  kind: z.enum(["related", "continues"]),
});
export const DiagnosticEntrySchema = z
  .object({
    kind: z.enum(["evidence", "opinion", "uncertainty"]),
    text: NonEmptyTextSchema.max(2_000),
    source: z.string().max(2_000).nullable(),
  })
  .superRefine((entry, context) => {
    if (entry.kind === "evidence" && !entry.source?.trim())
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Evidence requires a source",
      });
  });
export const SaveInitiativeDiagnosticRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative().nullable(),
  beneficiaries: z.array(NonEmptyTextSchema.max(255)).max(100),
  causes: z.array(DiagnosticEntrySchema).max(100),
  constraints: z.array(DiagnosticEntrySchema).max(100),
  previousAttempts: z.array(DiagnosticEntrySchema).max(100),
  hypotheses: z.array(DiagnosticEntrySchema).max(100),
  scope: NonEmptyTextSchema.max(2_000),
  risks: z.array(DiagnosticEntrySchema).max(100),
  resources: z.array(NonEmptyTextSchema.max(255)).max(100),
  nextExperiment: NonEmptyTextSchema.max(2_000).nullable(),
});
export const ActivateEvaluationStandardRequestSchema = z.object({
  organizationId: UuidSchema,
});
export const ProjectParticipantSchema = z.object({
  actorId: z.string().min(1).max(255),
  role: z.enum(["sponsor", "lead", "contributor", "observer"]),
});
export const CreateProjectFromInitiativeRequestSchema = z.object({
  organizationId: UuidSchema,
  initiativeId: UuidSchema,
  decisionId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  objective: NonEmptyTextSchema.max(2_000),
  boundaries: NonEmptyTextSchema.max(2_000),
  successCriteria: NonEmptyTextSchema.max(2_000),
  nextMilestone: NonEmptyTextSchema.max(255),
  sponsorActorId: z.string().min(1).max(255),
  leadActorId: z.string().min(1).max(255).nullable(),
  participants: z.array(ProjectParticipantSchema).min(1).max(100),
});
export const ChangeProjectStatusRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  status: z.enum([
    "pending_lead",
    "planned",
    "active",
    "paused",
    "blocked",
    "completed",
    "cancelled",
  ]),
});
export const AssignProjectLeadRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  leadActorId: z.string().min(1).max(255),
});
export const ReplaceProjectLeadRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  leadActorId: z.string().min(1).max(255),
  reason: NonEmptyTextSchema.max(1_000),
});
export const TransferProjectWorkspaceRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  workspaceId: UuidSchema,
  reason: NonEmptyTextSchema.max(1_000),
});
export const CancelProjectRequestSchema = z.object({
  organizationId: UuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  reason: NonEmptyTextSchema.max(2_000),
});
export const AddProjectMilestoneRequestSchema = z.object({
  organizationId: UuidSchema,
  title: NonEmptyTextSchema.max(255),
  dueOn: z.string().date().nullable(),
});
export const AddProjectNextActionRequestSchema = z.object({
  organizationId: UuidSchema,
  description: NonEmptyTextSchema.max(2_000),
  ownerActorId: z.string().min(1).max(255),
  dueOn: z.string().date().nullable(),
});
export const AcceptProjectDeliverableRequestSchema = z.object({
  organizationId: UuidSchema,
  name: NonEmptyTextSchema.max(255),
  documentId: UuidSchema,
  documentVersionId: UuidSchema,
});
export const CloseProjectRequestSchema = z.object({
  organizationId: UuidSchema,
  outcomes: NonEmptyTextSchema.max(10_000),
  lessonsLearned: NonEmptyTextSchema.max(10_000),
  pendingItems: z.array(NonEmptyTextSchema.max(2_000)).max(100),
});

export const InitiativeActionSchema = z.enum([
  "edit",
  "present",
  "review",
  "decide",
]);

export const InitiativeResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  title: z.string(),
  problemStatement: z.string(),
  expectedOutcome: z.string(),
  classification: z.enum(["internal", "confidential"]),
  requestedPriority: InitiativePrioritySchema.nullable(),
  operationalPriority: InitiativePrioritySchema.nullable(),
  status: InitiativeStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  allowedActions: z.array(InitiativeActionSchema),
  duplicateWarnings: z.array(
    z.object({
      initiativeId: UuidSchema,
      title: z.string(),
      createdAt: z.string().datetime(),
      matchedFields: z.array(z.enum(["title", "problem_statement"])),
    }),
  ),
});

export const InitiativeAuditEventSchema = z.object({
  id: UuidSchema,
  eventType: z.string(),
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  actorId: z.string(),
  correlationId: UuidSchema,
  occurredAt: z.string().datetime(),
  fromStatus: InitiativeStatusSchema.nullable(),
  toStatus: InitiativeStatusSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export const EvaluationStandardResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string(),
  objective: z.string().nullable(),
  boundaries: z.string().nullable(),
  successCriteria: z.string().nullable(),
  nextMilestone: z.string().nullable(),
  version: z.number().int().positive(),
  criteria: z.array(EvaluationCriterionInputSchema),
  isActive: z.boolean(),
  publishedAt: z.string().datetime(),
  publishedByActorId: z.string(),
});
export const TriageStandardResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string(),
  version: z.number().int().positive(),
  criteria: z.array(TriageCriterionInputSchema),
  isActive: z.boolean(),
  publishedAt: z.string().datetime(),
  publishedByActorId: z.string(),
});
export const InitiativeTriageResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  initiativeVersion: z.number().int().nonnegative(),
  standardId: UuidSchema,
  standardVersion: z.number().int().positive(),
  criteria: z.array(
    z.object({
      criterion: TriageCriterionInputSchema,
      assessment: z.enum(["pass", "fail", "not_applicable"]).nullable(),
      justification: z.array(z.string()),
    }),
  ),
  assessedByActorId: z.string(),
  assessedAt: z.string().datetime(),
});
export const IntakeResponsibilityResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  responsibleActorId: z.string(),
  assignedByActorId: z.string(),
  assignedAt: z.string().datetime(),
  nextReviewOn: z.string().date(),
});
export const UnassignedIntakeExceptionResponseSchema = z.object({
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  title: z.string(),
  updatedAt: z.string().datetime(),
});
export const InitiativeRelationshipResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  sourceInitiativeId: UuidSchema,
  targetInitiativeId: UuidSchema,
  kind: z.enum(["related", "continues"]),
  declaredByActorId: z.string(),
  declaredAt: z.string().datetime(),
});
export const InitiativeEvaluationResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  initiativeVersion: z.number().int().nonnegative(),
  standardId: UuidSchema,
  standardVersion: z.number().int().positive(),
  criteria: z.array(
    z.object({
      criterion: EvaluationCriterionInputSchema,
      assessment: z.enum(["met", "not_met", "not_applicable"]).nullable(),
      evidence: z.array(z.string()),
    }),
  ),
  coverage: z.object({
    totalCriteria: z.number().int(),
    applicableCriteria: z.number().int(),
    assessedCriteria: z.number().int(),
    notApplicableCriteria: z.number().int(),
    percentage: z.number().int(),
  }),
  quality: z
    .object({
      applicableWeight: z.number().nonnegative(),
      assessedWeight: z.number().nonnegative(),
      metWeight: z.number().nonnegative(),
      percentage: z.number().int().min(0).max(100),
    })
    .nullable(),
  evaluatedByActorId: z.string(),
  evaluatedAt: z.string().datetime(),
  annulledByActorId: z.string().nullable(),
  annulledAt: z.string().datetime().nullable(),
  annulmentReason: z.string().nullable(),
});
export const EvaluationReviewerAssignmentResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  assignedActorId: z.string(),
  assignedByActorId: z.string(),
  assignedAt: z.string().datetime(),
  status: z.enum([
    "assigned",
    "abstained",
    "reassigned",
    "escalated",
    "completed",
  ]),
  statusChangedAt: z.string().datetime(),
  statusChangedByActorId: z.string(),
  reason: z.string().nullable(),
});
export const InitiativeDecisionResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  initiativeId: UuidSchema,
  evaluationId: UuidSchema,
  outcome: z.enum(["approved", "rejected", "returned", "cancelled"]),
  rationale: z.string(),
  evidence: z.array(z.string()),
  standardId: UuidSchema,
  standardVersion: z.number().int().positive(),
  coverage: z.object({
    totalCriteria: z.number().int(),
    applicableCriteria: z.number().int(),
    assessedCriteria: z.number().int(),
    notApplicableCriteria: z.number().int(),
    percentage: z.number().int(),
  }),
  quality: z
    .object({
      applicableWeight: z.number().nonnegative(),
      assessedWeight: z.number().nonnegative(),
      metWeight: z.number().nonnegative(),
      percentage: z.number().int().min(0).max(100),
    })
    .nullable(),
  decidedByActorId: z.string(),
  decidedAt: z.string().datetime(),
  nextReviewOn: z.string().date().nullable(),
  conditions: z.array(
    z.object({
      id: UuidSchema,
      description: z.string(),
      responsibleActorId: z.string(),
      dueOn: z.string().date(),
      status: z.enum(["pending", "fulfilled", "exempted"]),
      resolvedByActorId: z.string().nullable(),
      resolvedAt: z.string().datetime().nullable(),
      resolutionNote: z.string().nullable(),
    }),
  ),
});
export const ProjectResponseSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  workspaceId: UuidSchema,
  sourceInitiativeId: UuidSchema,
  sourceDecisionId: UuidSchema,
  name: z.string(),
  objective: z.string().nullable(),
  boundaries: z.string().nullable(),
  successCriteria: z.string().nullable(),
  nextMilestone: z.string().nullable(),
  sponsorActorId: z.string(),
  leadActorId: z.string().nullable(),
  participants: z.array(ProjectParticipantSchema),
  status: z.enum([
    "pending_lead",
    "planned",
    "active",
    "paused",
    "blocked",
    "completed",
    "cancelled",
  ]),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CreateInitiativeDraftRequest = z.infer<
  typeof CreateInitiativeDraftRequestSchema
>;
export type SubmitInitiativeRequest = z.infer<
  typeof SubmitInitiativeRequestSchema
>;
export type UpdateInitiativeRequest = z.infer<
  typeof UpdateInitiativeRequestSchema
>;
export type SetInitiativeOperationalPriorityRequest = z.infer<
  typeof SetInitiativeOperationalPriorityRequestSchema
>;
export type StartReviewRequest = z.infer<typeof StartReviewRequestSchema>;
export type AssignEvaluationReviewerRequest = z.infer<
  typeof AssignEvaluationReviewerRequestSchema
>;
export type AbstainFromEvaluationReviewRequest = z.infer<
  typeof AbstainFromEvaluationReviewRequestSchema
>;
export type ReassignEvaluationReviewRequest = z.infer<
  typeof ReassignEvaluationReviewRequestSchema
>;
export type EscalateEvaluationReviewAbstentionRequest = z.infer<
  typeof EscalateEvaluationReviewAbstentionRequestSchema
>;
export type DecideInitiativeRequest = z.infer<
  typeof DecideInitiativeRequestSchema
>;
export type ExemptDecisionConditionRequest = z.infer<
  typeof ExemptDecisionConditionRequestSchema
>;
export type FulfillDecisionConditionRequest = z.infer<
  typeof FulfillDecisionConditionRequestSchema
>;
export type PublishEvaluationStandardRequest = z.infer<
  typeof PublishEvaluationStandardRequestSchema
>;
export type PublishTriageStandardRequest = z.infer<
  typeof PublishTriageStandardRequestSchema
>;
export type TriageInitiativeRequest = z.infer<
  typeof TriageInitiativeRequestSchema
>;
export type AssignIntakeResponsibilityRequest = z.infer<
  typeof AssignIntakeResponsibilityRequestSchema
>;
export type DeclareInitiativeRelationshipRequest = z.infer<
  typeof DeclareInitiativeRelationshipRequestSchema
>;
export type InitiativeResponse = z.infer<typeof InitiativeResponseSchema>;
export type InitiativeAuditEvent = z.infer<typeof InitiativeAuditEventSchema>;
export type EvaluationStandardResponse = z.infer<
  typeof EvaluationStandardResponseSchema
>;
export type TriageStandardResponse = z.infer<
  typeof TriageStandardResponseSchema
>;
export type InitiativeTriageResponse = z.infer<
  typeof InitiativeTriageResponseSchema
>;
export type IntakeResponsibilityResponse = z.infer<
  typeof IntakeResponsibilityResponseSchema
>;
export type UnassignedIntakeExceptionResponse = z.infer<
  typeof UnassignedIntakeExceptionResponseSchema
>;
export type InitiativeRelationshipResponse = z.infer<
  typeof InitiativeRelationshipResponseSchema
>;
export type InitiativeEvaluationResponse = z.infer<
  typeof InitiativeEvaluationResponseSchema
>;
export type InitiativeDecisionResponse = z.infer<
  typeof InitiativeDecisionResponseSchema
>;
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
