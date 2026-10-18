import { publicVenues } from "@/lib/places";
import { fail } from "@/lib/planner-server";

export async function GET() {
  try {
    return Response.json({ venues: await publicVenues() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
