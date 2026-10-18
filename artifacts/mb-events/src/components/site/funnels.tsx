import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, CircleCheck, Pin, X } from 'lucide-react';
import { eventTypes, type EventTypeValue } from '@/lib/content';
import { Button, Field, HoneypotField, Label } from '@/components/site/ui';
import { checkDateAvailability, normalizeEventType, submitLead, type DateAvailability } from '@/lib/leads';

function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

type DirectoryVenue = {
  id: string;
  name: string;
  area: string;
  capacity: string;
  description: string;
  photos: { url: string }[];
};

export { BuildMyEventWizard } from '@/components/site/builder';
export type { BuilderPayload } from '@/components/site/builder';

function eventTypeTestId(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function ProgressRail({
  labels,
  index,
  tone = 'champagne',
}: {
  labels: string[];
  index: number;
  tone?: 'crimson' | 'champagne';
}) {
  const fill = ((index + 1) / labels.length) * 100;
  const bar = tone === 'champagne' ? 'bg-[var(--mb-champagne)]' : 'bg-[var(--mb-champagne)]';
  return (
    <div>
      <div className="flex items-center justify-between gap-1 px-5 pb-2 sm:px-7">
        {labels.map((label, i) => {
          const active = i === index;
          const done = i < index;
          return (
            <span
              key={label}
              className={`min-w-0 flex-1 truncate text-center font-mono text-[9px] uppercase tracking-[.12em] sm:text-[10px] sm:tracking-[.16em] ${
                active ? 'text-[var(--mb-ivory)]' : done ? 'text-[var(--mb-champagne)]' : 'text-[var(--mb-muted)]'
              }`}
            >
              {label}
            </span>
          );
        })}
      </div>
      <div className="h-1 w-full bg-[var(--mb-elevated)]" role="progressbar" aria-valuenow={Math.round(fill)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full transition-all duration-500 ease-out ${bar}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
const DATE_STEPS = ['date', 'type', 'contact'] as const;
type DateStep = (typeof DATE_STEPS)[number];

const dateStepMeta: Record<DateStep, { label: string; title: string; sub: string }> = {
  date: {
    label: 'Date',
    title: 'Is your night open?',
    sub: 'Pick a date — we’ll check the calendar. No commitment yet.',
  },
  type: {
    label: 'Celebrate',
    title: 'What are you celebrating?',
    sub: 'Tap the one that fits — we’ll tailor the check from here.',
  },
  contact: {
    label: 'Contact',
    title: 'Almost done — where should we reply?',
    sub: 'An inquiry does not reserve the date. A specialist will follow up — a date is only reserved after MB Events confirms a booking.',
  },
};

export function CheckMyDateModal({
  onClose,
  onContinueBuild,
}: {
  onClose: () => void;
  onContinueBuild?: (opts: { selectedType: EventTypeValue; eventDate: string }) => void;
}) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'form' | 'done'>('form');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<DateAvailability | null>(null);
  const [checkingDate, setCheckingDate] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    eventDate: '',
    eventType: '' as EventTypeValue | '',
    website: '',
  });
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEscapeClose(onClose);

  useEffect(() => () => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
  }, []);

  const current = DATE_STEPS[step];
  const meta = dateStepMeta[current];

  const canContinueDate = () => {
    if (current === 'date') return !!form.eventDate;
    if (current === 'type') return !!form.eventType;
    return true;
  };

  const loadAvailability = async (date: string) => {
    setCheckingDate(true);
    setError('');
    try {
      const result = await checkDateAvailability(date);
      setAvailability(result);
      return result;
    } catch (cause) {
      setAvailability(null);
      setError(cause instanceof Error ? cause.message : 'We could not check that date. Please try again.');
      return null;
    } finally {
      setCheckingDate(false);
    }
  };

  const next = async () => {
    setError('');
    if (current === 'date' && !form.eventDate) {
      setError('Pick a date so we can check the calendar — a best guess is fine.');
      return;
    }
    if (current === 'date') {
      const result = availability?.date === form.eventDate ? availability : await loadAvailability(form.eventDate);
      if (!result) return;
    }
    if (current === 'type' && !form.eventType) {
      setError('Tap a celebration type to continue.');
      return;
    }
    setStep((s) => Math.min(s + 1, DATE_STEPS.length - 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.firstName || !form.phone || !form.eventDate || !form.eventType) {
      setError('Add your name and phone so we can follow up about this date.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const latest = availability?.date === form.eventDate ? availability : await checkDateAvailability(form.eventDate);
      setAvailability(latest);
      await submitLead({
        source: 'availability', name: [form.firstName, form.lastName].filter(Boolean).join(' '),
        email: form.email.trim(), phone: form.phone.trim(),
        eventType: normalizeEventType(form.eventType), eventDate: form.eventDate,
        notes: latest ? `Public date check: ${latest.status}. ${latest.message}` : undefined,
        website: form.website,
      });
      setPhase('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not send your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--mb-ink)]/70 p-0 backdrop-blur-md sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Check my date">
      <div className="mb-glass-strong flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[var(--mb-glass-border)] shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="sticky top-0 z-10 border-b border-[var(--mb-glass-border)] bg-[var(--mb-ink)]/40 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">
                Check my date
                {phase === 'form' ? (current === 'contact' ? ' · Almost done' : ` · ${step + 1} of ${DATE_STEPS.length}`) : ''}
              </p>
              <h2 className="mt-1 font-display text-[1.85rem] leading-none text-[var(--mb-ivory)] sm:text-3xl">
                {phase === 'form' && meta.title}
                {phase === 'done' && 'Request received'}
              </h2>
            </div>
            <button data-testid="button-close-date" onClick={onClose} className="shrink-0 rounded-full p-2 text-[var(--mb-ivory)] hover:bg-[var(--mb-elevated)]" aria-label="Close">
              <X size={20} />
            </button>
          </div>
          {phase === 'form' && (
            <ProgressRail
              labels={DATE_STEPS.map((s) => dateStepMeta[s].label)}
              index={step}
              tone="champagne"
            />
          )}
        </div>

        {phase === 'done' && (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-8 py-16 text-center animate-rise">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--mb-champagne)] text-[var(--mb-ink)]">
              <CircleCheck size={38} />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">Request received</p>
            <h3 className="mt-3 max-w-md font-display text-4xl leading-[1.02] text-[var(--mb-ivory)]">
              {availability?.status === 'reserved' ? 'We’ll follow up about other dates.' : 'We’ll follow up shortly.'}
            </h3>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[var(--mb-muted)]">
              {availability?.message || `An MB Event Specialist will reach out about ${form.eventDate}.`}
              {' '}Your inquiry does not reserve the date. Want to keep shaping the night while you wait?
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {onContinueBuild && form.eventType && (
                <Button
                  onClick={() => onContinueBuild({ selectedType: form.eventType as EventTypeValue, eventDate: form.eventDate })}
                  variant="red"
                  testId="button-date-to-build"
                >
                  Build my event
                </Button>
              )}
              <Button onClick={onClose} variant="ghost" testId="button-close-date-success" showArrow={false}>
                Back to the site
              </Button>
            </div>
          </div>
        )}

        {phase === 'form' && (
          <form
            onSubmit={
              current === 'contact'
                ? submit
                : (e) => {
                    e.preventDefault();
                    next();
                  }
            }
            className="flex flex-1 flex-col overflow-y-auto"
          >
            <div className="flex-1 space-y-5 px-5 py-6 sm:px-7 sm:py-8 animate-rise" key={current}>
              <p className="text-sm leading-6 text-[var(--mb-muted)]">{meta.sub}</p>

              {current === 'date' && (
                <div>
                  <Label>Event date</Label>
                  <div className="relative mt-2">
                    <input
                      data-testid="input-date-check-date"
                      type="date"
                      required
                      value={form.eventDate}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm((c) => ({ ...c, eventDate: value }));
                        setAvailability(null);
                        setError('');
                        if (value) {
                          if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
                          autoAdvanceRef.current = setTimeout(() => {
                            void loadAvailability(value).then((result) => {
                              if (result) setStep(1);
                            });
                          }, 380);
                        }
                      }}
                      className="h-14 w-full border border-[var(--mb-line-strong)] bg-[var(--mb-ink)]/40 px-4 text-base text-[var(--mb-ivory)] outline-none focus:border-[var(--mb-champagne)] [color-scheme:dark] sm:h-12 sm:text-sm"
                    />
                    <CalendarDays className="pointer-events-none absolute right-4 top-4 text-[var(--mb-muted)] sm:top-3.5" size={18} />
                  </div>
                  {checkingDate && <p className="mt-3 text-sm text-[var(--mb-muted)]">Checking the calendar…</p>}
                  {availability && availability.date === form.eventDate && (
                    <p data-testid="status-date-availability" className="mt-3 border-l-2 border-[var(--mb-champagne)] bg-[var(--mb-champagne)]/10 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)]">
                      {availability.message}
                    </p>
                  )}
                </div>
              )}

              {current === 'type' && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {eventTypes.map((type) => {
                    const selected = form.eventType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        data-testid={`button-date-type-${eventTypeTestId(type.value)}`}
                        onClick={() => {
                          setForm((c) => ({ ...c, eventType: type.value }));
                          setError('');
                          if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
                          autoAdvanceRef.current = setTimeout(() => setStep(2), 320);
                        }}
                        className={`min-h-[64px] border px-3 py-4 text-left text-[11px] font-extrabold uppercase leading-snug tracking-[.08em] transition-all active:scale-[0.98] ${
                          selected
                            ? 'border-[var(--mb-champagne)] bg-[var(--mb-champagne)] text-[var(--mb-ink)]'
                            : 'border-[var(--mb-line-strong)] text-[var(--mb-ivory)] hover:border-[var(--mb-champagne)]'
                        }`}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {current === 'contact' && (
                <div className="relative space-y-5">
                  <HoneypotField value={form.website} onChange={(v) => setForm((c) => ({ ...c, website: v }))} />
                  {availability && (
                    <p data-testid="status-date-availability-contact" className="border-l-2 border-[var(--mb-champagne)] bg-[var(--mb-champagne)]/10 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)]">
                      {availability.message}
                    </p>
                  )}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="First name" value={form.firstName} onChange={(v) => setForm((c) => ({ ...c, firstName: v }))} required testId="input-date-first-name" />
                    <Field label="Last name" value={form.lastName} onChange={(v) => setForm((c) => ({ ...c, lastName: v }))} testId="input-date-last-name" />
                    <Field label="Email (optional)" type="email" value={form.email} onChange={(v) => setForm((c) => ({ ...c, email: v }))} testId="input-date-email" />
                    <Field label="Phone" type="tel" value={form.phone} onChange={(v) => setForm((c) => ({ ...c, phone: v }))} required testId="input-date-phone" />
                  </div>
                </div>
              )}

              {error && (
                <p data-testid="status-date-error" className="border-l-2 border-[var(--mb-champagne)] bg-[var(--mb-champagne)]/10 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)]" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--mb-glass-border)] bg-[var(--mb-ink)]/45 px-5 py-4 backdrop-blur-xl sm:px-7">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
                    setStep((s) => s - 1);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)] hover:text-[var(--mb-ivory)]"
                >
                  <ArrowLeft size={14} /> Back
                </button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                variant="red"
                testId={current === 'contact' ? 'button-submit-date' : 'button-date-next'}
                disabled={submitting || (current !== 'contact' && !canContinueDate())}
                className="min-h-[48px] min-w-[8.5rem]"
              >
                {submitting || checkingDate ? 'Working…' : current === 'contact' ? 'Send inquiry' : 'Continue'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function FindVenueModal({
  onClose,
  onRequest,
}: {
  onClose: () => void;
  onRequest: (opts: { venueName: string; venueId?: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [venues, setVenues] = useState<DirectoryVenue[] | null>(null);
  useEscapeClose(onClose);
  useEffect(() => {
    let gone = false;
    fetch('/api/venues')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { venues?: DirectoryVenue[] } | null) => {
        if (!gone) setVenues(Array.isArray(body?.venues) ? body.venues : []);
      })
      .catch(() => { if (!gone) setVenues([]); });
    return () => { gone = true; };
  }, []);
  const filtered = (venues || []).filter(
    (v) =>
      !query ||
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      (v.area || '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--mb-ink)]/90 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Find a venue">
      <div className="mb-glass-strong flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-[var(--mb-glass-border)] shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="sticky top-0 z-10 border-b border-[var(--mb-glass-border)] bg-[var(--mb-ink)]/40 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">Find a venue</p>
              <h2 className="font-display text-3xl text-[var(--mb-ivory)]">Published rooms</h2>
            </div>
            <button data-testid="button-close-venue" onClick={onClose} className="rounded-full p-2 text-[var(--mb-ivory)] hover:bg-[var(--mb-elevated)]" aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <div className="relative mt-4">
            <Pin className="pointer-events-none absolute left-3 top-3.5 text-[var(--mb-muted)]" size={16} />
            <input
              data-testid="input-venue-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search published venues…"
              className="h-12 w-full border border-[var(--mb-line-strong)] bg-[var(--mb-ink)]/40 pl-10 pr-4 text-sm text-[var(--mb-ivory)] outline-none placeholder:text-[var(--mb-muted)] focus:border-[var(--mb-champagne)]"
            />
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-6 sm:px-7">
          {venues === null && <p className="text-sm text-[var(--mb-muted)]">Loading venues…</p>}
          {venues && filtered.length === 0 && (
            <div className="border border-dashed border-[var(--mb-line)] px-6 py-12 text-center">
              <p className="font-display text-2xl text-[var(--mb-ivory)]">No matches yet</p>
              <p className="mt-2 text-sm text-[var(--mb-muted)]">Tell us what you’re looking for — we’ll help match a room.</p>
              <Button onClick={() => onRequest({ venueName: query || 'Looking for a venue' })} variant="red" testId="button-venue-empty-request" className="mt-6">
                Request venue help
              </Button>
            </div>
          )}
          {filtered.map((v, i) => (
            <button
              key={v.id}
              type="button"
              data-testid={`button-venue-pick-${i}`}
              onClick={() => onRequest({ venueName: v.name, venueId: v.id })}
              className="group flex w-full gap-4 overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-surface)]/40 text-left transition-colors hover:border-[var(--mb-champagne)]"
            >
              {v.photos[0] ? (
                <img src={v.photos[0].url} alt="" className="h-28 w-28 shrink-0 object-cover sm:h-32 sm:w-40" loading="lazy" />
              ) : (
                <div className="h-28 w-28 shrink-0 bg-[var(--mb-elevated)] sm:h-32 sm:w-40" />
              )}
              <div className="flex flex-1 flex-col justify-center py-3 pr-4">
                <p className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{v.area || 'Long Island'}</p>
                <h3 className="mt-1 font-display text-2xl text-[var(--mb-ivory)]">{v.name}</h3>
                <p className="mt-1 text-xs text-[var(--mb-muted)]">{v.capacity ? `${v.capacity} guests` : v.description || 'Request details'}</p>
                <span className="mt-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-champagne)] opacity-0 transition-opacity group-hover:opacity-100">
                  Request info →
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
