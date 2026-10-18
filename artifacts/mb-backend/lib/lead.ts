import { z } from "zod";

export const eventTypes = ["Wedding", "Sweet 16", "Quinceañera", "Bar Mitzvah", "Bat Mitzvah", "Birthday", "Corporate", "School Event", "Private Party", "Other"] as const;
export const guestRanges = ["1–50", "50–100", "100–150", "150–250", "250–500", "500+"] as const;
export const vibes = ["Modern Luxury", "Nightclub", "Elegant", "Romantic", "High Energy", "Glow", "Black & Gold", "Garden", "Minimal", "Custom", "The Nightclub", "Modern Elegance", "Traditional"] as const;
export const priorities = ["Music", "Lighting", "Big Entrance", "Dancing", "Photos", "Video", "Decor", "Guest Experience", "Venue", "Everything"] as const;

export const leadSchema = z.object({
  source: z.enum(["builder", "availability", "venue", "contact", "blueprint"]),
  name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]),
  phone: z.string().trim().max(30).refine((value) => value === "" || (value.length >= 7 && /^[+()\d.\s-]+$/.test(value)), "Enter a valid phone number"),
  eventType: z.enum(eventTypes),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  guestCount: z.enum(guestRanges).optional().nullable(),
  location: z.string().trim().max(160).optional().nullable(),
  venueStatus: z.enum(["selected", "need_venue", "deciding"]).optional().nullable(),
  vibe: z.enum(vibes).optional().nullable(),
  priorities: z.array(z.enum(priorities)).max(10).default([]),
  contactMethod: z.enum(["phone", "email", "either"]).default("either"),
  campaign: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  venueId: z.union([z.literal(""), z.string().uuid()]).optional().nullable(),
  vendorId: z.union([z.literal(""), z.string().uuid()]).optional().nullable(),
  referredBy: z.string().trim().max(200).optional().nullable(),
  venueName: z.string().trim().max(200).optional().nullable(),
  services: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
  budgetCents: z.number().int().nonnegative().max(2_000_000_000).optional().nullable(),
  budget: z.union([
    z.null(),
    z.number().nonnegative().max(20_000_000),
    z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/),
  ]).optional(),
  website: z.string().max(0).optional(),
}).superRefine((lead, context) => {
  if (["builder", "availability", "venue"].includes(lead.source) && !lead.phone) {
    context.addIssue({ code: "custom", path: ["phone"], message: "A phone number is required" });
  }
  if (!lead.email && !lead.phone) {
    context.addIssue({ code: "custom", path: ["email"], message: "Add an email or phone number" });
  }
});

export type LeadInput = z.infer<typeof leadSchema>;
