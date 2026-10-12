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

export async function submitLead(input: LeadInput): Promise<void> {
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'We could not send your request. Please try again.';
    throw new Error(message);
  }
}
