import { randomUUID } from "node:crypto";
import { db, leadsTable } from "@workspace/db";
import { CreateLeadBody, CreateLeadResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/leads", async (req, res): Promise<void> => {
  // A filled honeypot is treated as a successful submission without storing it.
  if (
    typeof req.body?.website === "string" &&
    req.body.website.trim().length > 0
  ) {
    res.status(201).json(
      CreateLeadResponse.parse({
        id: randomUUID(),
        status: "received",
        createdAt: new Date(),
      }),
    );
    return;
  }

  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { fields: parsed.error.issues.map((issue: { path: PropertyKey[] }) => issue.path.join(".")) },
      "Invalid event inquiry",
    );
    res.status(400).json({ error: "Please check the required inquiry details." });
    return;
  }

  const input = parsed.data;
  const [lead] = await db
    .insert(leadsTable)
    .values({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      eventType: input.eventType,
      eventDate: input.eventDate
        ? input.eventDate.toISOString().slice(0, 10)
        : null,
      eventDateUnknown: input.eventDateUnknown,
      guestCount: input.guestCount,
      venueName: input.venueName?.trim() || null,
      services: input.services,
      message: input.message?.trim() || null,
      source: input.source,
    })
    .returning({
      id: leadsTable.id,
      createdAt: leadsTable.createdAt,
    });

  if (!lead) {
    res.status(500).json({ error: "We could not save your inquiry. Please try again." });
    return;
  }

  res.status(201).json(
    CreateLeadResponse.parse({
      ...lead,
      status: "received",
    }),
  );
});

export default router;