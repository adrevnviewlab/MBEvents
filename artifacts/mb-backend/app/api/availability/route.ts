import { getDateAvailability, isValidEventDate } from "@/lib/availability";
import { fail } from "@/lib/planner-server";
import { limits } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await limits.availabilityCheck(request);
    const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
    if (!date || !isValidEventDate(date)) {
      return Response.json({
        date,
        status: "unavailable",
        reserved: false,
        guaranteed: false,
        message: "Enter a valid event date.",
        timezone: "",
      }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const availability = await getDateAvailability(date);
    return Response.json(availability, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
