import { z } from 'zod';

const localAtSchema = z.object({
  date: z.string(),
  time: z.string(),
  time_zone: z.string()
}).strict();

const dailySchema = z.object({ time: z.string(), time_zone: z.string() }).strict();
const weeklySchema = z.object({
  time: z.string(),
  time_zone: z.string(),
  weekdays: z.array(z.number())
}).strict();
const cronSchema = z.object({ expression: z.string(), time_zone: z.string() }).strict();

export const scheduleCreateRequestSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  after_seconds: z.number().optional(),
  at: z.union([z.string(), localAtSchema]).optional(),
  every_seconds: z.number().optional(),
  daily: dailySchema.optional(),
  weekly: weeklySchema.optional(),
  cron: cronSchema.optional()
}).strict();

export const createSchedulePayloadSchema = z.object({
  sessionId: z.string().min(1),
  request: scheduleCreateRequestSchema
}).strict();

export const scheduleRecordSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('after'), title: z.string(), prompt: z.string(), afterSeconds: z.number(), scheduledAt: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal('at'), title: z.string(), prompt: z.string(), scheduledAt: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal('every'), title: z.string(), prompt: z.string(), everySeconds: z.number(), scheduledAt: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal('daily'), title: z.string(), prompt: z.string(), time: z.string(), timeZone: z.string(), scheduledAt: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal('weekly'), title: z.string(), prompt: z.string(), time: z.string(), timeZone: z.string(), weekdays: z.array(z.number()), scheduledAt: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal('cron'), title: z.string(), prompt: z.string(), expression: z.string(), timeZone: z.string(), scheduledAt: z.string() }).strict()
]);

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().optional()
}).strict();

export const noResultSchema = z.void();
