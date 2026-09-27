import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, CircleCheck, X } from 'lucide-react';
import {
  eventTypes,
  experiences,
  type EventTypeValue,
  type ExperienceId,
  type LeadSource,
} from '@/lib/content';
import { Button, Field, Label } from '@/components/site/ui';

const STEPS = ['celebrate', 'place', 'guests', 'include', 'contact'] as const;
type Step = (typeof STEPS)[number];

const stepMeta: Record<Step, { label: string; title: string; sub: string }> = {
  celebrate: {
    label: 'Celebrate',
    title: 'What are you celebrating?',
    sub: 'Check one. Add a note if you want — a best guess is perfect.',
  },
  place: {
    label: 'When',
    title: 'When and where?',
    sub: 'Check what you know. Write the details underneath.',
  },
  guests: {
    label: 'Guests',
    title: 'How big is the party?',
    sub: 'Check a range, type a number, or say you’re not sure yet.',
  },
  include: {
    label: 'Include',
    title: 'What should the night include?',
    sub: 'Check anything that matters. Skip the rest — we’ll recommend.',
  },
  contact: {
    label: 'Contact',
    title: 'How do we reach you?',
    sub: 'Name and phone are enough. We’ll only use this to plan your event.',
  },
};

const whenOptions = [
  { id: 'date', label: 'I have a date' },
  { id: 'month', label: 'I have a rough month' },
  { id: 'unknown', label: 'I don’t know yet' },
] as const;

const whereOptions = [
  { id: 'have', label: 'We already have a venue' },
  { id: 'need', label: 'We need a venue' },
  { id: 'deciding', label: 'Still deciding' },
] as const;

const guestOptions = ['Under 75', '75–150', '150–250', '250–400', '400+', 'Not sure yet'];

const includeOptions = [
  { id: 'entertainment', label: 'DJ & MC' },
  { id: 'lighting-production', label: 'Lighting & uplighting' },
  { id: 'photo-experiences', label: 'Photo booth' },
  { id: 'photography-video', label: 'Photography & video' },
  { id: 'specialty-dancers', label: 'Dancers / party motivators' },
  { id: 'event-planning', label: 'Planning help' },
  { id: 'specialty-extras', label: 'Karaoke, casino, or games' },
  { id: 'specialist', label: 'Not sure — recommend for me' },
];

const reachOptions = [
  { id: 'call', label: 'Call me' },
  { id: 'text', label: 'Text me' },
  { id: 'email', label: 'Email me' },
];

const DRAFT_KEY = 'mb-build-draft';

type WhenId = (typeof whenOptions)[number]['id'];
type WhereId = (typeof whereOptions)[number]['id'];

export type BuilderPayload = {
  source: LeadSource;
  eventType: EventTypeValue;
  eventDate: string | null;
  eventDateUnknown: boolean;
  guestCount: string;
  venueName: string;
  vibe: string;
  experienceId?: ExperienceId;
  services: string[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
};

type Draft = {
  eventType: EventTypeValue | '';
  eventNote: string;
  whenMode: WhenId | '';
  whenDetail: string;
  whereMode: WhereId | '';
  venueName: string;
  guestCount: string;
  guestExact: string;
  includes: string[];
  includeNote: string;
  firstName: string;
  phone: string;
  email: string;
  reach: string[];
  message: string;
};

function emptyDraft(seed?: Partial<Draft>): Draft {
  return {
    eventType: '',
    eventNote: '',
    whenMode: '',
    whenDetail: '',
    whereMode: '',
    venueName: '',
    guestCount: '',
    guestExact: '',
    includes: [],
    includeNote: '',
    firstName: '',
    phone: '',
    email: '',
    reach: ['call'],
    message: '',
    ...seed,
  };
}

function experienceIncludes(id?: ExperienceId): string[] {
  if (id === 'nightclub') return ['entertainment', 'lighting-production', 'specialty-dancers'];
  if (id === 'luxury') return ['entertainment', 'lighting-production', 'photography-video'];
  if (id === 'takeover') return ['entertainment', 'lighting-production', 'photo-experiences', 'photography-video', 'event-planning'];
  return [];
}

function CheckChip({
  selected,
  label,
  onClick,
  testId,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex min-h-[52px] items-center gap-3 border px-4 py-3 text-left text-sm transition-all active:scale-[0.99] ${
        selected
          ? 'border-[var(--mb-champagne)] bg-[var(--mb-champagne)] text-[var(--mb-ink)]'
          : 'border-[var(--mb-line-strong)] text-[var(--mb-ivory)] hover:border-[var(--mb-champagne)]'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center border ${
          selected ? 'border-[var(--mb-ink)] bg-[var(--mb-ink)] text-[var(--mb-champagne)]' : 'border-[var(--mb-line-strong)]'
        }`}
      >
        {selected && <Check size={12} />}
      </span>
      <span className="font-medium leading-snug">{label}</span>
    </button>
  );
}

function WriteBox({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-2 w-full resize-none border border-[var(--mb-line-strong)] bg-[var(--mb-ink)]/40 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)] outline-none placeholder:text-[var(--mb-muted)] focus:border-[var(--mb-champagne)]"
      />
    </label>
  );
}

export function BuildMyEventWizard({
  selectedType,
  source = 'website_builder',
  experienceId,
  initialServices,
  initialVenue,
  initialDate,
  initialNote,
  onClose,
}: {
  selectedType?: EventTypeValue;
  source?: LeadSource;
  experienceId?: ExperienceId;
  initialServices?: string[];
  initialVenue?: string;
  initialDate?: string;
  initialDateUnknown?: boolean;
  initialNote?: string;
  onClose: () => void;
}) {
  const experience = experiences.find((e) => e.id === experienceId);
  const prefilled = !!(selectedType || initialDate || initialVenue || initialServices?.length || experienceId || initialNote);

  const [stepIndex, setStepIndex] = useState(0);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Draft>(() => {
    const seeded = emptyDraft({
      eventType: selectedType ?? '',
      whenMode: initialDate ? 'date' : '',
      whenDetail: initialDate ?? '',
      whereMode: initialVenue ? 'have' : '',
      venueName: initialVenue ?? '',
      includes: [...new Set([...(initialServices ?? []), ...experienceIncludes(experienceId)])],
      includeNote: initialNote ?? '',
      message: experience ? `Interested in: ${experience.title}` : initialNote ? `Build this look: ${initialNote}` : '',
    });
    if (prefilled) return seeded;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return seeded;
      return { ...seeded, ...JSON.parse(raw) };
    } catch {
      return seeded;
    }
  });

  useEffect(() => {
    if (sent) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  }, [form, sent]);

  const step = STEPS[stepIndex];
  const meta = stepMeta[step];
  const patch = (partial: Partial<Draft>) => {
    setError('');
    setForm((c) => ({ ...c, ...partial }));
  };

  const toggleInclude = (id: string) => {
    setForm((c) => {
      if (id === 'specialist') return { ...c, includes: c.includes.includes('specialist') ? [] : ['specialist'] };
      const without = c.includes.filter((x) => x !== 'specialist' && x !== id);
      return { ...c, includes: c.includes.includes(id) ? without : [...without, id] };
    });
    setError('');
  };

  const toggleReach = (id: string) => {
    setForm((c) => ({
      ...c,
      reach: c.reach.includes(id) ? c.reach.filter((x) => x !== id) : [...c.reach, id],
    }));
  };

  const canContinue = () => {
    if (step === 'celebrate') return !!form.eventType;
    if (step === 'place') return !!form.whenMode && !!form.whereMode;
    if (step === 'guests') return !!form.guestCount || !!form.guestExact;
    if (step === 'include') return true;
    return !!form.firstName.trim() && !!form.phone.trim();
  };

  const next = () => {
    if (!canContinue()) {
      setError(
        step === 'celebrate'
          ? 'Check the celebration that fits.'
          : step === 'place'
            ? 'Check a timing option and a venue option.'
            : step === 'guests'
              ? 'Check a guest range, or type a number.'
              : 'Add your first name and phone.',
      );
      return;
    }
    setError('');
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const back = () => {
    setError('');
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.eventType || !form.firstName.trim() || !form.phone.trim()) {
      setError('Add your first name and phone so we know how to reach you.');
      return;
    }
    setSubmitting(true);
    const guestCount = form.guestExact.trim() || form.guestCount || 'Not sure yet';
    const whenLine =
      form.whenMode === 'unknown' ? 'Date not set yet' : form.whenDetail.trim() || form.whenMode;
    const whereLine =
      form.whereMode === 'have'
        ? form.venueName.trim() || 'Venue selected'
        : form.whereMode === 'need'
          ? `Need a venue${form.venueName.trim() ? ` · ${form.venueName.trim()}` : ''}`
          : `Still deciding${form.venueName.trim() ? ` · ${form.venueName.trim()}` : ''}`;
    const payload: BuilderPayload = {
      source,
      eventType: form.eventType,
      eventDate: form.whenMode === 'date' && form.whenDetail ? form.whenDetail : null,
      eventDateUnknown: form.whenMode !== 'date',
      guestCount,
      venueName: whereLine,
      vibe: 'help-me',
      experienceId,
      services: form.includes.length ? form.includes : ['specialist'],
      firstName: form.firstName.trim(),
      lastName: '',
      email: form.email.trim(),
      phone: form.phone.trim(),
      message: [
        form.eventNote && `About the event: ${form.eventNote}`,
        `When: ${whenLine}`,
        `Where: ${whereLine}`,
        form.includeNote && `Notes: ${form.includeNote}`,
        form.reach.length && `Reach by: ${form.reach.join(', ')}`,
        form.message,
      ]
        .filter(Boolean)
        .join('\n'),
    };
    console.log('[MB Events] Build My Event inquiry', payload);
    await new Promise((r) => setTimeout(r, 600));
    localStorage.removeItem(DRAFT_KEY);
    setSubmitting(false);
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--mb-ink)]/90 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Build my event">
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-charcoal)] shadow-2xl sm:max-h-[90dvh]">
        <div className="sticky top-0 z-10 border-b border-[var(--mb-line)] bg-[var(--mb-charcoal)]/95 backdrop-blur-md">
          <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-7">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">
                Build my event · {stepIndex + 1} of {STEPS.length}
              </p>
              <h2 className="mt-1 font-display text-[1.85rem] leading-none text-[var(--mb-ivory)] sm:text-4xl">{sent ? 'You’re on our list' : meta.title}</h2>
            </div>
            <button data-testid="button-close-builder" onClick={onClose} className="shrink-0 rounded-full p-2 text-[var(--mb-ivory)] hover:bg-[var(--mb-elevated)]" aria-label="Close">
              <X size={20} />
            </button>
          </div>
          {!sent && (
            <div className="flex gap-1 px-5 pb-4 sm:px-7">
              {STEPS.map((s, i) => (
                <span key={s} className={`h-1 flex-1 ${i <= stepIndex ? 'bg-[var(--mb-champagne)]' : 'bg-[var(--mb-elevated)]'}`} />
              ))}
            </div>
          )}
        </div>

        {sent ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-8 py-16 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--mb-champagne)] text-[var(--mb-ink)]">
              <CircleCheck size={36} />
            </div>
            <h3 className="max-w-md font-display text-4xl leading-[1.05] text-[var(--mb-ivory)]">
              Thanks, {form.firstName}. Your {form.eventType.toLowerCase()} is on our radar.
            </h3>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[var(--mb-muted)]">
              An MB Event Specialist will reach out shortly — usually within one business day — with ideas for the night.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="tel:18556276863" className="inline-flex min-h-12 items-center justify-center bg-[var(--mb-champagne)] px-5 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)]">
                Call now
              </a>
              <Button onClick={onClose} variant="ghost" testId="button-builder-done" showArrow={false}>
                Back to the site
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={step === 'contact' ? submit : (e) => { e.preventDefault(); next(); }}
            className="flex flex-1 flex-col overflow-y-auto"
          >
            <div className="flex-1 space-y-5 px-5 py-6 sm:px-7" key={step}>
              <p className="text-sm leading-6 text-[var(--mb-muted)]">{meta.sub}</p>

              {step === 'celebrate' && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {eventTypes.map((type) => (
                      <CheckChip
                        key={type.value}
                        testId={`button-event-type-${type.value.replaceAll(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`}
                        label={type.label}
                        selected={form.eventType === type.value}
                        onClick={() => patch({ eventType: type.value })}
                      />
                    ))}
                  </div>
                  <WriteBox
                    label="Tell us a little more (optional)"
                    value={form.eventNote}
                    onChange={(eventNote) => patch({ eventNote })}
                    placeholder="50th birthday, company holiday party, bilingual ceremony…"
                    testId="input-event-note"
                  />
                </div>
              )}

              {step === 'place' && (
                <div className="space-y-6">
                  <div>
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">When</p>
                    <div className="grid gap-2">
                      {whenOptions.map((opt) => (
                        <CheckChip
                          key={opt.id}
                          testId={`button-when-${opt.id}`}
                          label={opt.label}
                          selected={form.whenMode === opt.id}
                          onClick={() => patch({ whenMode: opt.id })}
                        />
                      ))}
                    </div>
                    {form.whenMode && form.whenMode !== 'unknown' && (
                      <div className="mt-3">
                        <Field
                          label={form.whenMode === 'date' ? 'Date' : 'Month or season'}
                          type={form.whenMode === 'date' ? 'date' : 'text'}
                          value={form.whenDetail}
                          onChange={(whenDetail) => patch({ whenDetail })}
                          placeholder={form.whenMode === 'month' ? 'June, or next spring' : ''}
                          testId="input-when-detail"
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">Where</p>
                    <div className="grid gap-2">
                      {whereOptions.map((opt) => (
                        <CheckChip
                          key={opt.id}
                          testId={`button-where-${opt.id}`}
                          label={opt.label}
                          selected={form.whereMode === opt.id}
                          onClick={() => patch({ whereMode: opt.id })}
                        />
                      ))}
                    </div>
                    <div className="mt-3">
                      <Field
                        label="Venue or town (optional)"
                        value={form.venueName}
                        onChange={(venueName) => patch({ venueName })}
                        placeholder="Crest Hollow, Huntington…"
                        testId="input-venue-name"
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 'guests' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {guestOptions.map((g) => (
                      <CheckChip
                        key={g}
                        testId={`button-guests-${g}`}
                        label={g}
                        selected={form.guestCount === g}
                        onClick={() => patch({ guestCount: g })}
                      />
                    ))}
                  </div>
                  <Field
                    label="Or type an exact number"
                    type="number"
                    value={form.guestExact}
                    onChange={(guestExact) => patch({ guestExact })}
                    placeholder="e.g. 180"
                    testId="input-guest-count"
                  />
                </div>
              )}

              {step === 'include' && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {includeOptions.map((opt) => (
                      <CheckChip
                        key={opt.id}
                        testId={`button-service-${opt.id}`}
                        label={opt.label}
                        selected={form.includes.includes(opt.id)}
                        onClick={() => toggleInclude(opt.id)}
                      />
                    ))}
                  </div>
                  <WriteBox
                    label="Anything specific? (optional)"
                    value={form.includeNote}
                    onChange={(includeNote) => patch({ includeNote })}
                    placeholder="Sparkler entrance, first dance, must-play songs…"
                    testId="input-include-note"
                  />
                </div>
              )}

              {step === 'contact' && (
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="First name" value={form.firstName} onChange={(firstName) => patch({ firstName })} required testId="input-first-name" />
                    <Field label="Phone" type="tel" value={form.phone} onChange={(phone) => patch({ phone })} required testId="input-phone" />
                  </div>
                  <Field label="Email (optional)" type="email" value={form.email} onChange={(email) => patch({ email })} testId="input-email" />
                  <div>
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">Best way to reach you</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {reachOptions.map((opt) => (
                        <CheckChip key={opt.id} testId={`button-reach-${opt.id}`} label={opt.label} selected={form.reach.includes(opt.id)} onClick={() => toggleReach(opt.id)} />
                      ))}
                    </div>
                  </div>
                  <WriteBox
                    label="Anything else? (optional)"
                    value={form.message}
                    onChange={(message) => patch({ message })}
                    placeholder="Timeline notes, surprises, questions…"
                    testId="input-message"
                  />
                </div>
              )}

              {error && (
                <p data-testid="status-builder-error" className="border-l-2 border-[var(--mb-champagne)] bg-[var(--mb-champagne)]/10 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)]" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--mb-line)] bg-[var(--mb-charcoal)]/98 px-5 py-4 backdrop-blur-md sm:px-7">
              {stepIndex > 0 ? (
                <button type="button" data-testid="button-builder-back" onClick={back} className="inline-flex min-h-[44px] items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)] hover:text-[var(--mb-ivory)]">
                  <ArrowLeft size={14} /> Back
                </button>
              ) : (
                <span />
              )}
              {step === 'contact' ? (
                <Button type="submit" variant="red" testId="button-submit-builder" showArrow={!submitting} disabled={submitting} className="min-h-[48px]">
                  {submitting ? 'Sending…' : 'Send to MB'}
                </Button>
              ) : (
                <Button type="submit" variant="red" testId="button-builder-next" className="min-h-[48px]">
                  Continue
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
