import { requireActor } from "@/lib/admin";
import { bookLead, leadProfile } from "@/lib/crm";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "events.write");
    const { id } = await params;
    const profile = await leadProfile(id);
    if (!profile) throw new AppError("Lead not found.", 404);
    const lead = profile.lead;
    const booked = await bookLead({
      leadId: id,
      actor,
      details: {
        clientNames: lead.name,
        email: lead.email,
        phone: lead.phone,
        eventType: lead.event_type,
        eventDate: (lead.event_date ?? "").slice(0, 10),
        venueName: lead.venue_name || lead.location || "",
        guestCount: lead.guest_count ?? "",
      },
    });
    return Response.json(booked, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
