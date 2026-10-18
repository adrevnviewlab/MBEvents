import { z } from "zod";
import { AppError } from "@/lib/errors";

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Please check the details.";
    throw new AppError(message, 400);
  }
  return parsed.data;
}
