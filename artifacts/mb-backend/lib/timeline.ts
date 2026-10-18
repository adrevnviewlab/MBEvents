/**
 * Run-of-show helpers for the single planner_events.data.timeline array.
 * Staff briefs, client portal, and admin Control Room all read this same record.
 */

export const timelineKinds = [
  "setup",
  "soundcheck",
  "guest_arrival",
  "introductions",
  "ceremony",
  "cocktail",
  "dinner",
  "speech",
  "performance",
  "dancing",
  "special",
  "breakdown",
  "custom",
] as const;

export type TimelineKind = (typeof timelineKinds)[number];

export type TimelineItem = {
  id: string;
  time: string;
  endTime?: string;
  what: string;
  song: string;
  who: string;
  kind?: TimelineKind;
  notes?: string;
  staffId?: string;
  vendorId?: string;
  clientVisible?: boolean;
};

export const timelineKindLabels: Record<TimelineKind, string> = {
  setup: "Setup",
  soundcheck: "Soundcheck",
  guest_arrival: "Guest arrival",
  introductions: "Introductions",
  ceremony: "Ceremony",
  cocktail: "Cocktail hour",
  dinner: "Dinner",
  speech: "Speech / toast",
  performance: "Performance",
  dancing: "Dancing",
  special: "Special moment",
  breakdown: "Breakdown",
  custom: "Custom",
};

export function isTimelineKind(value: string | undefined | null): value is TimelineKind {
  return !!value && (timelineKinds as readonly string[]).includes(value);
}

export function inferTimelineKind(what: string): TimelineKind {
  const w = what.toLowerCase();
  if (/\b(setup|load-?in|load in|gear)\b/.test(w)) return "setup";
  if (/\b(sound\s*check|soundcheck|line check)\b/.test(w)) return "soundcheck";
  if (/\b(guest arrival|arrival|cocktail|networking|doors)\b/.test(w)) return "guest_arrival";
  if (/\b(introduction|grand entrance|court entrance)\b/.test(w)) return "introductions";
  if (/\b(ceremony|processional|recessional)\b/.test(w)) return "ceremony";
  if (/\bdinner|plated|buffet|motzi|kiddush\b/.test(w)) return "dinner";
  if (/\b(toast|speech|remarks|welcome|awards|presentation)\b/.test(w)) return "speech";
  if (/\b(performance|show|entertainment)\b/.test(w)) return "performance";
  if (/\b(danc|hora|open dancing|last dance|father-daughter|mother-son|first dance|waltz)\b/.test(w)) return "dancing";
  if (/\b(cake|bouquet|garter|candle|send-?off|special)\b/.test(w)) return "special";
  if (/\b(breakdown|strike|pack.?out|load.?out|close)\b/.test(w)) return "breakdown";
  if (/\bcocktail\b/.test(w)) return "cocktail";
  return "custom";
}

/** Parse "7:00 PM", "19:00", "7pm" → minutes from midnight, or null. */
export function parseTimelineMinutes(value: string | undefined | null): number | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59 || hour > 23) return null;
  const meridiem = (match[3] || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour > 23) return null;
  return hour * 60 + minute;
}

export function formatTimelineMinutes(total: number): string {
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

export type TimelineWarning = {
  id: string;
  itemId?: string;
  level: "warn" | "info";
  message: string;
};

export function timelineWarnings(items: TimelineItem[]): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  let previousStart: number | null = null;
  let previousEnd: number | null = null;
  let previousLabel = "";

  items.forEach((item, index) => {
    const start = parseTimelineMinutes(item.time);
    const end = parseTimelineMinutes(item.endTime);
    const label = item.what || `Item ${index + 1}`;

    if (start != null && end != null && end < start) {
      warnings.push({
        id: `${item.id}-end-before-start`,
        itemId: item.id,
        level: "warn",
        message: `"${label}" ends before it starts.`,
      });
    }

    if (previousStart != null && start != null && start < previousStart) {
      warnings.push({
        id: `${item.id}-order`,
        itemId: item.id,
        level: "warn",
        message: `"${label}" starts earlier than "${previousLabel}" above — check order or times.`,
      });
    }

    const priorEnd = previousEnd ?? previousStart;
    if (priorEnd != null && start != null && start < priorEnd) {
      warnings.push({
        id: `${item.id}-overlap`,
        itemId: item.id,
        level: "warn",
        message: `"${label}" overlaps the previous moment ("${previousLabel}").`,
      });
    }

    if (start != null) {
      previousStart = start;
      previousEnd = end != null ? end : null;
      previousLabel = label;
    }
  });

  return warnings;
}

export function normalizeTimelineItem(item: Partial<TimelineItem> & { id: string; what?: string }): TimelineItem {
  const what = String(item.what ?? "").slice(0, 300);
  const kind = isTimelineKind(item.kind) ? item.kind : inferTimelineKind(what);
  return {
    id: item.id,
    time: String(item.time ?? "").slice(0, 200),
    endTime: String(item.endTime ?? "").slice(0, 200),
    what,
    song: String(item.song ?? "").slice(0, 200),
    who: String(item.who ?? "").slice(0, 200),
    kind,
    notes: String(item.notes ?? "").slice(0, 2000),
    staffId: item.staffId ? String(item.staffId).slice(0, 60) : undefined,
    vendorId: item.vendorId ? String(item.vendorId).slice(0, 60) : undefined,
    clientVisible: item.clientVisible !== false,
  };
}

/**
 * Client portal must not drop staff-only moments when saving a filtered list.
 * Visible order follows the client's list; staff-only rows stay at their relative slots.
 */
export function mergeClientTimeline(existing: TimelineItem[], incoming: TimelineItem[]): TimelineItem[] {
  const normalizedExisting = existing.map(normalizeTimelineItem);
  const visible = incoming.map((item) => normalizeTimelineItem({ ...item, clientVisible: true }));
  const result = [...visible];

  for (const item of normalizedExisting) {
    if (item.clientVisible !== false) continue;
    const originalIndex = normalizedExisting.findIndex((row) => row.id === item.id);
    const visibleBefore = normalizedExisting
      .slice(0, Math.max(originalIndex, 0))
      .filter((row) => row.clientVisible !== false).length;
    const insertAt = Math.min(visibleBefore, result.length);
    result.splice(insertAt, 0, item);
  }

  return result;
}

export function clientVisibleTimeline(items: TimelineItem[]): TimelineItem[] {
  return items.map(normalizeTimelineItem).filter((item) => item.clientVisible !== false);
}

export function emptyTimelineItem(id: string, patch: Partial<TimelineItem> = {}): TimelineItem {
  return normalizeTimelineItem({
    id,
    time: "",
    endTime: "",
    what: "",
    song: "",
    who: "",
    kind: "custom",
    notes: "",
    clientVisible: true,
    ...patch,
  });
}
