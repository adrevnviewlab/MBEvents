import type { EventTypeValue } from './content';

export type LeadSource = 'builder' | 'availability' | 'venue' | 'contact' | 'blueprint';

export interface LeadInput {
  source: LeadSource;
  name: string;
  email: string;
  phone: string;
  eventType: 'Wedding' | 'Sweet 16' | 'Quinceañera' | 'Bar Mitzvah' | 'Bat Mitzvah' | 'Birthday' | 'Corporate' | 'School Event' | 'Private Party' | 'Other';
  eventDate?: string | null;
  guestCount?: '1–50' | '50–100' | '100–150' | '150–250' | '250–500' | '500+' | null;
  location?: string | null;
  venueStatus?: 'selected' | 'need_venue' | 'deciding' | null;
  vibe?: 'Modern Luxury' | 'Nightclub' | 'Elegant' | 'Romantic' | 'High Energy' | 'Glow' | 'Black & Gold' | 'Garden' | 'Minimal' | 'Custom' | 'The Nightclub' | 'Modern Elegance' | 'Traditional' | null;
  priorities?: ('Music' | 'Lighting' | 'Big Entrance' | 'Dancing' | 'Photos' | 'Video' | 'Decor' | 'Guest Experience' | 'Venue' | 'Everything')[];
  contactMethod?: 'phone' | 'email' | 'either';
  notes?: string | null;
  venueId?: string | null;
  vendorId?: string | null;
  referredBy?: string | null;
  campaign?: string | null;
  venueName?: string | null;
  services?: string[];
  budget?: string | number | null;
  budgetCents?: number | null;
  /** Honeypot — must stay empty. */
  website?: string;
}

const ATTR_KEY = 'mb-lead-attr';

export type LeadAttribution = {
  campaign?: string;
  referredBy?: string;
  landingPath?: string;
};

function cleanAttr(value: string | null | undefined, max: number) {
  return (value ?? '').trim().slice(0, max);
}

/** Capture UTM / referral params on first land; persist for the session. */
export function captureLeadAttribution(search = typeof window !== 'undefined' ? window.location.search : '', path = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(search);
  const campaign = cleanAttr(
    params.get('utm_campaign') || params.get('campaign') || params.get('utm_source') || params.get('gclid'),
    120,
  );
  const referredBy = cleanAttr(params.get('ref') || params.get('referred_by') || params.get('utm_medium'), 200);
  if (!campaign && !referredBy) return;
  const next: LeadAttribution = {
    ...(readStoredAttribution() || {}),
    ...(campaign ? { campaign } : {}),
    ...(referredBy ? { referredBy } : {}),
    landingPath: path.slice(0, 160),
  };
  try {
    sessionStorage.setItem(ATTR_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

function readStoredAttribution(): LeadAttribution | null {
  try {
    const raw = sessionStorage.getItem(ATTR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeadAttribution;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function leadAttribution(): LeadAttribution {
  return readStoredAttribution() || {};
}

export function normalizeEventType(type: EventTypeValue): LeadInput['eventType'] {
  const map: Partial<Record<EventTypeValue, LeadInput['eventType']>> = {
    'Bar / Bat Mitzvah': 'Bar Mitzvah',
    'Birthday Party': 'Birthday',
    'Corporate Event': 'Corporate',
    'School / Graduation Event': 'School Event',
  };
  return map[type] ?? type as LeadInput['eventType'];
}

export function normalizeGuests(value: string): LeadInput['guestCount'] {
  if (!value || value === 'Not sure yet') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    if (number <= 50) return '1–50';
    if (number <= 100) return '50–100';
    if (number <= 150) return '100–150';
    if (number <= 250) return '150–250';
    if (number <= 500) return '250–500';
    return '500+';
  }
  if (value === 'Under 75') return '50–100';
  if (value === '75–150') return '100–150';
  if (value === '150–250') return '150–250';
  if (value === '250–400') return '250–500';
  if (value === '400+') return '500+';
  return null;
}

export type DateAvailability = {
  date: string;
  status: 'open' | 'reserved' | 'unavailable';
  reserved: boolean;
  message: string;
  guaranteed: false;
  timezone: string;
};

export async function checkDateAvailability(date: string): Promise<DateAvailability> {
  const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}`, {
    credentials: 'same-origin',
  });
  const body = (await response.json().catch(() => null)) as DateAvailability | { error?: string } | null;
  if (!response.ok || !body || !('status' in body)) {
    throw new Error((body && 'error' in body && body.error) || 'We could not check that date. Please try again.');
  }
  return body;
}

export async function submitLead(input: LeadInput): Promise<{ leadId?: string }> {
  const attr = leadAttribution();
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      ...input,
      campaign: input.campaign ?? attr.campaign ?? null,
      referredBy: input.referredBy ?? attr.referredBy ?? null,
      website: input.website ?? '',
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(leadError(body));
  }
  const body = (await response.json().catch(() => null)) as { leadId?: string } | null;
  return body || {};
}

function leadError(body: unknown) {
  if (body && typeof body === 'object' && 'fields' in body && body.fields && typeof body.fields === 'object') {
    for (const value of Object.values(body.fields as Record<string, unknown>)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
    }
  }
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  return 'We could not send your request. Please try again.';
}
