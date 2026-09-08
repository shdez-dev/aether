import { z } from "zod";

export const UuidSchema = z.string().uuid();
export const CorrelationIdSchema = UuidSchema.brand<"CorrelationId">();
export const NonEmptyTextSchema = z.string().trim().min(1).max(10_000);

export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
