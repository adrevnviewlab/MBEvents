import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarRange,
  Check,
  CircleCheck,
  Compass,
  HelpCircle,
  Mail,
  MessageSquare,
  Phone,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  A,
  M,
  eventTypes,
  experiences,
  serviceCategories,
  type EventTypeValue,
  type ExperienceId,
  type LeadSource,
} from '@/lib/content';
import { Button, Field, Label } from '@/components/site/ui';
import { SpringChoice } from '@/components/site/motion';

const STEPS = ['celebrate', 'place', 'guests', 'include', 'contact'] as const;
type Step = (typeof STEPS)[number];

const stepMeta: Record<Step, { label: string; title: string; sub: string }> = {
  celebrate: {
    label: 'Celebrate',
    title: 'What are you celebrating?',
    sub: 'Tap a night — the preview follows.',
  },
  place: {
    label: 'When',
    title: 'When and where?',
    sub: 'Lock a date if you have one — or tell us you’re still deciding.',
  },
  guests: {
    label: 'Guests',
    title: 'How big is the party?',
    sub: 'Watch the floor fill. A range is enough.',
  },
  include: {
    label: 'Include',
    title: 'What should the night include?',
    sub: 'Layer the looks. Skip anything you’re not sure about.',
  },
  contact: {
    label: 'Contact',
    title: 'How do we reach you?',
    sub: 'Name and phone are enough. We’ll only use this to plan your event.',
  },
};

const whenOptions = [
  {
    id: 'date',
    label: 'I have a date',
    blurb: 'Lock it so we can protect the night.',
    image: `${M}sparkler-entrance-poster.jpg`,
    Icon: CalendarDays,
  },
  {
    id: 'month',
    label: 'I have a rough month',
    blurb: 'A season is enough to start.',
    image: `${M}hero3-table.jpg`,
    Icon: CalendarRange,
  },
  {
    id: 'unknown',
    label: 'I don’t know yet',
    blurb: 'We’ll help you find the window.',
    image: `${M}uplighting-ballroom.jpg`,
    Icon: HelpCircle,
  },
] as const;

const whereOptions = [
  {
    id: 'have',
    label: 'We already have a venue',
    blurb: 'Tell us the room — we likely know it.',
    image: `${A}hero-ballroom.jpg`,
    Icon: Building2,
  },
  {
    id: 'need',
    label: 'We need a venue',
    blurb: 'We’ll match a Long Island favorite.',
    image: `${M}hero1.jpg`,
    Icon: Search,
  },
  {
    id: 'deciding',
    label: 'Still deciding',
    blurb: 'Keep a few rooms in play.',
    image: `${M}venue-harbor.jpg`,
    Icon: Compass,
  },
] as const;

const guestOptions = [
  { label: 'Under 75', level: 1 },
  { label: '75–150', level: 2 },
  { label: '150–250', level: 3 },
  { label: '250–400', level: 4 },
  { label: '400+', level: 5 },
  { label: 'Not sure yet', level: 3 },
] as const;

function catImage(id: string) {
  return serviceCategories.find((c) => c.id === id)?.image ?? `${M}uplighting-ballroom.jpg`;
}

const includeOptions = [
  { id: 'entertainment', label: 'DJ & MC', blurb: 'Sound, hosting, the floor.', image: catImage('entertainment') },
  { id: 'lighting-production', label: 'Lighting & uplighting', blurb: 'Color, lasers, the glow.', image: catImage('lighting-production') },
  { id: 'photo-experiences', label: 'Photo booth', blurb: 'Keepsakes guests take home.', image: catImage('photo-experiences') },
  { id: 'photography-video', label: 'Photography & video', blurb: 'The moments you’ll keep.', image: catImage('photography-video') },
  { id: 'specialty-dancers', label: 'Dancers / party motivators', blurb: 'Energy on the floor.', image: catImage('specialty') },
  { id: 'event-planning', label: 'Planning help', blurb: 'Cues, timing, no stress.', image: catImage('event-planning') },
  { id: 'specialty-extras', label: 'Karaoke, casino, or games', blurb: 'The extras that surprise.', image: catImage('specialty') },
  { id: 'specialist', label: 'Not sure — recommend for me', blurb: 'We’ll map the night for you.', image: `${M}service-planning.jpg` },
];

const reachOptions = [
  { id: 'call', label: 'Call me', Icon: Phone },
  { id: 'text', label: 'Text me', Icon: MessageSquare },
  { id: 'email', label: 'Email me', Icon: Mail },
] as const;

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

function guestDensity(form: Draft): number {
  const n = Number(form.guestExact);
  if (Number.isFinite(n) && n > 0) return Math.min(1, Math.max(0.08, n / 420));
  const found = guestOptions.find((g) => g.label === form.guestCount);
  if (!found) return 0;
  if (form.guestCount === 'Not sure yet') return 0.4;
  return found.level / 5;
}

function formatWhen(form: Draft) {
  if (form.whenMode === 'date' && form.whenDetail) {
    const parsed = new Date(`${form.whenDetail}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return form.whenDetail;
  }
  if (form.whenMode === 'month') return form.whenDetail.trim() || 'a month in mind';
  if (form.whenMode === 'unknown') return 'date open';
  return '';
}

function previewStory(form: Draft) {
  const type = eventTypes.find((t) => t.value === form.eventType);
  const guests = form.guestExact.trim() || form.guestCount;
  const when = formatWhen(form);
  const where =
    form.venueName.trim() ||
    (form.whereMode === 'have' ? 'your venue' : form.whereMode === 'need' ? 'finding a room' : form.whereMode === 'deciding' ? 'choosing a room' : '');
  const bits = [guests && `${guests} guests`, when, where].filter(Boolean);
  return {
    kicker: type ? 'Tonight looks like' : 'Your night starts here',
    title: type?.label ?? 'Build the room',
    line: type ? bits.join(' · ') || type.blurb : 'Pick a celebration — lighting, guests, and the floor will follow.',
  };
}

function seedDots(count: number) {
  const out: { x: number; y: number; h: number; o: number }[] = [];
  let seed = 17;
  for (let i = 0; i < count; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = 4 + (seed % 920) / 10;
    seed = (seed * 16807) % 2147483647;
    const y = 8 + (seed % 780) / 10;
    seed = (seed * 16807) % 2147483647;
    const h = 7 + (seed % 14);
    const o = 0.35 + (i % 5) * 0.1;
    out.push({ x, y, h, o });
  }
  return out;
}

const FLOOR_DOTS = seedDots(72);

function CrowdFloor({ density }: { density: number }) {
  const visible = Math.round(density * FLOOR_DOTS.length);
  if (visible <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[32%] sm:h-[36%]" aria-hidden>
      <div
        className="absolute inset-x-[-12%] bottom-[-8%] h-[120%] opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(201,176,122,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(201,176,122,.22) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          transform: 'perspective(420px) rotateX(62deg)',
          transformOrigin: 'center bottom',
        }}
      />
      {FLOOR_DOTS.slice(0, visible).map((dot, i) => (
        <span
          key={i}
          className="absolute w-[3px] rounded-full bg-[var(--mb-ivory)] shadow-[0_0_6px_rgba(201,176,122,.55)]"
          style={{
            left: `${dot.x}%`,
            bottom: `${dot.y * 0.42}%`,
            height: dot.h,
            opacity: dot.o,
          }}
        />
      ))}
    </div>
  );
}

function CrowdMini({ level }: { level: number }) {
  return (
    <div className="flex h-9 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span
          key={i}
          className="w-[5px] rounded-sm bg-[var(--mb-champagne)]"
          style={{
            height: `${22 + ((i * 19 + level * 11) % 72)}%`,
            opacity: i < 1 + level * 1.3 ? 1 : 0.18,
          }}
        />
      ))}
    </div>
  );
}

function NightPreview({ form, sent }: { form: Draft; sent: boolean }) {
  const reduceMotion = useReducedMotion();
  const type = eventTypes.find((t) => t.value === form.eventType);
  const image = type?.image ?? `${M}uplighting-ballroom.jpg`;
  const density = guestDensity(form);
  const story = previewStory(form);
  const hasLights = form.includes.includes('lighting-production');
  const hasDj = form.includes.includes('entertainment');
  const hasPhoto = form.includes.includes('photo-experiences') || form.includes.includes('photography-video');
  const hasDancers = form.includes.includes('specialty-dancers');
  const chips = includeOptions.filter((opt) => form.includes.includes(opt.id) && opt.id !== 'specialist').slice(0, 4);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[var(--mb-ink)]">
      <AnimatePresence mode="sync" initial={false}>
        <motion.img
          key={image}
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          initial={reduceMotion ? false : { opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as const }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/45 to-[var(--mb-ink)]/20" />
      <motion.div
        aria-hidden
        className="absolute inset-0 mix-blend-overlay"
        animate={{ opacity: hasLights ? 1 : 0 }}
        transition={{ duration: 0.5 }}
        style={{
          background:
            'radial-gradient(ellipse at 20% 80%, rgba(201,176,122,.55), transparent 55%), radial-gradient(ellipse at 85% 30%, rgba(196,69,74,.35), transparent 50%)',
        }}
      />
      {hasDj && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-screen" aria-hidden>
          <span className="laser-beam absolute left-[42%] top-[-10%] h-[140%] w-px bg-gradient-to-b from-transparent via-sky-300/80 to-transparent" />
          <span className="laser-beam absolute left-[58%] top-[-10%] h-[140%] w-px bg-gradient-to-b from-transparent via-[var(--mb-champagne)]/80 to-transparent [animation-delay:-1.6s]" />
          <span className="laser-beam absolute left-[50%] top-[-10%] h-[140%] w-px bg-gradient-to-b from-transparent via-fuchsia-300/50 to-transparent [animation-delay:-3.2s]" />
        </div>
      )}
      {hasDj && (
        <div className="pointer-events-none absolute left-5 top-5 z-[2] hidden h-9 items-end gap-[3px] sm:flex" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className="eq-bar w-[4px] rounded-sm bg-[var(--mb-champagne)]"
              style={{ height: '100%', animationDelay: `${i * 0.09}s` }}
            />
          ))}
        </div>
      )}
      {hasPhoto && (
        <div className="pointer-events-none absolute right-4 top-12 z-[3] hidden w-24 rotate-6 sm:block" aria-hidden>
          <div className="border border-white/30 bg-white/90 p-1 shadow-xl">
            <img src={catImage('photo-experiences')} alt="" className="aspect-[4/5] w-full object-cover" />
          </div>
          <div className="absolute -left-6 top-8 -rotate-12 border border-white/30 bg-white/90 p-1 shadow-xl">
            <img src={catImage('photography-video')} alt="" className="aspect-[4/5] w-16 object-cover" />
          </div>
        </div>
      )}
      {hasDancers && (
        <p className="pointer-events-none absolute right-5 top-5 font-mono text-[9px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">
          Motivators on the floor
        </p>
      )}
      <CrowdFloor density={density} />
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/90 to-transparent px-5 pb-5 pt-16 sm:px-7 sm:pb-7">
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">{sent ? 'You’re on our list' : story.kicker}</p>
        <p className="mt-2 font-display text-3xl leading-[.95] text-[var(--mb-ivory)] sm:text-4xl lg:text-5xl">{story.title}</p>
        <p className="mt-2 max-w-sm text-xs leading-5 text-white/70 sm:text-sm sm:leading-6">{story.line}</p>
        {chips.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.id}
                className="border border-[var(--mb-champagne)]/40 bg-[var(--mb-ink)]/55 px-2 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-[var(--mb-champagne)] backdrop-blur-sm"
              >
                {chip.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SelectedMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center border transition-colors ${
        selected
          ? 'border-[var(--mb-champagne)] bg-[var(--mb-champagne)] text-[var(--mb-ink)]'
          : 'border-[var(--mb-champagne)]/35 bg-transparent text-transparent'
      }`}
    >
      <Check size={12} strokeWidth={3} />
    </span>
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
  const reduceMotion = useReducedMotion();

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

  const stepEase = [0.22, 1, 0.36, 1] as const;
  const stepMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.28, ease: stepEase },
      };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[var(--mb-ink)]/90 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Build my event"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 1 }}
        className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-charcoal)] shadow-2xl lg:min-h-[min(88dvh,740px)] lg:flex-row"
      >
        <aside className="relative h-[200px] shrink-0 sm:h-[248px] lg:h-auto lg:w-[40%]">
          <NightPreview form={form} sent={sent} />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="sticky top-0 z-10 border-b border-[var(--mb-line)] bg-[var(--mb-charcoal)]/95 backdrop-blur-md">
            <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-7">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">
                  Build my event · {stepIndex + 1} of {STEPS.length}
                </p>
                <h2 className="mt-1 font-display text-[1.85rem] leading-none text-[var(--mb-ivory)] sm:text-4xl">
                  {sent ? 'You’re on our list' : meta.title}
                </h2>
              </div>
              <button
                data-testid="button-close-builder"
                onClick={onClose}
                className="shrink-0 rounded-full p-2 text-[var(--mb-ivory)] hover:bg-[var(--mb-elevated)]"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            {!sent && (
              <div className="flex gap-1 px-5 pb-4 sm:px-7">
                {STEPS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (i < stepIndex) {
                        setError('');
                        setStepIndex(i);
                      }
                    }}
                    className="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
                    aria-current={i === stepIndex ? 'step' : undefined}
                    aria-label={`${stepMeta[s].label}${i <= stepIndex ? '' : ' (upcoming)'}`}
                  >
                    <span className={`h-1 w-full ${i <= stepIndex ? 'bg-[var(--mb-champagne)]' : 'bg-[var(--mb-elevated)]'}`} />
                    <span
                      className={`hidden truncate font-mono text-[9px] uppercase tracking-[.14em] sm:block ${
                        i === stepIndex ? 'text-[var(--mb-ivory)]' : i < stepIndex ? 'text-[var(--mb-champagne)]' : 'text-[var(--mb-muted)]'
                      }`}
                    >
                      {stepMeta[s].label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {sent ? (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center px-8 py-16 text-center">
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
                <a
                  href="tel:18556276863"
                  className="inline-flex min-h-12 items-center justify-center bg-[var(--mb-champagne)] px-5 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)]"
                >
                  Call now
                </a>
                <Button onClick={onClose} variant="ghost" testId="button-builder-done" showArrow={false}>
                  Back to the site
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={
                step === 'contact'
                  ? submit
                  : (e) => {
                      e.preventDefault();
                      next();
                    }
              }
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <div className="flex-1 px-5 py-6 pb-10 sm:px-7">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={step} className="space-y-5" {...stepMotion}>
                    <p className="text-sm leading-6 text-[var(--mb-muted)]">{meta.sub}</p>

                    {step === 'celebrate' && (
                      <div className="space-y-4">
                        <div className="surface-group grid gap-2 sm:grid-cols-2">
                          {eventTypes.map((type) => {
                            const selected = form.eventType === type.value;
                            return (
                              <SpringChoice
                                key={type.value}
                                testId={`button-event-type-${type.value.replaceAll(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`}
                                label={type.label}
                                selected={selected}
                                onClick={() => patch({ eventType: type.value })}
                                className="min-h-[132px]"
                              >
                                <img
                                  src={type.image}
                                  alt=""
                                  className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ${selected ? 'scale-105' : 'group-hover:scale-105'}`}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/40 to-transparent" />
                                <span className="relative z-10 flex h-full min-h-[132px] flex-col justify-between p-3.5">
                                  <SelectedMark selected={selected} />
                                  <span>
                                    <span className="block font-display text-xl leading-tight text-[var(--mb-ivory)]">{type.label}</span>
                                    <span className="mt-1 block text-[11px] leading-4 text-white/65">{type.blurb}</span>
                                  </span>
                                </span>
                              </SpringChoice>
                            );
                          })}
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
                          <div className="surface-group grid gap-2">
                            {whenOptions.map((opt) => {
                              const selected = form.whenMode === opt.id;
                              return (
                                <SpringChoice
                                  key={opt.id}
                                  testId={`button-when-${opt.id}`}
                                  label={opt.label}
                                  selected={selected}
                                  onClick={() => patch({ whenMode: opt.id })}
                                  className="min-h-[88px]"
                                >
                                  <img src={opt.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
                                  <div className="absolute inset-0 bg-gradient-to-r from-[var(--mb-ink)] via-[var(--mb-ink)]/80 to-[var(--mb-ink)]/25" />
                                  <span className="relative z-10 flex items-center gap-4 px-4 py-4">
                                    <SelectedMark selected={selected} />
                                    <span className="flex h-10 w-10 items-center justify-center border border-[var(--mb-champagne)]/40 bg-[var(--mb-ink)]/50 text-[var(--mb-champagne)]">
                                      <opt.Icon size={18} />
                                    </span>
                                    <span>
                                      <span className="block text-sm font-medium text-[var(--mb-ivory)]">{opt.label}</span>
                                      <span className="mt-0.5 block text-[11px] text-white/60">{opt.blurb}</span>
                                    </span>
                                  </span>
                                </SpringChoice>
                              );
                            })}
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
                          <div className="surface-group grid gap-2">
                            {whereOptions.map((opt) => {
                              const selected = form.whereMode === opt.id;
                              return (
                                <SpringChoice
                                  key={opt.id}
                                  testId={`button-where-${opt.id}`}
                                  label={opt.label}
                                  selected={selected}
                                  onClick={() => patch({ whereMode: opt.id })}
                                  className="min-h-[88px]"
                                >
                                  <img src={opt.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
                                  <div className="absolute inset-0 bg-gradient-to-r from-[var(--mb-ink)] via-[var(--mb-ink)]/80 to-[var(--mb-ink)]/25" />
                                  <span className="relative z-10 flex items-center gap-4 px-4 py-4">
                                    <SelectedMark selected={selected} />
                                    <span className="flex h-10 w-10 items-center justify-center border border-[var(--mb-champagne)]/40 bg-[var(--mb-ink)]/50 text-[var(--mb-champagne)]">
                                      <opt.Icon size={18} />
                                    </span>
                                    <span>
                                      <span className="block text-sm font-medium text-[var(--mb-ivory)]">{opt.label}</span>
                                      <span className="mt-0.5 block text-[11px] text-white/60">{opt.blurb}</span>
                                    </span>
                                  </span>
                                </SpringChoice>
                              );
                            })}
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
                        <div className="surface-group grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {guestOptions.map((g) => {
                            const selected = form.guestCount === g.label;
                            return (
                              <SpringChoice
                                key={g.label}
                                testId={`button-guests-${g.label}`}
                                label={g.label}
                                selected={selected}
                                onClick={() => patch({ guestCount: g.label })}
                                className="min-h-[108px] bg-[var(--mb-elevated)]/80"
                              >
                                <span className="relative z-10 flex h-full min-h-[108px] flex-col justify-between p-3.5">
                                  <span className="flex items-start justify-between gap-2">
                                    <CrowdMini level={g.level} />
                                    <SelectedMark selected={selected} />
                                  </span>
                                  <span className="text-sm font-medium leading-snug text-[var(--mb-ivory)]">{g.label}</span>
                                </span>
                              </SpringChoice>
                            );
                          })}
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
                        <div className="surface-group grid gap-2 sm:grid-cols-2">
                          {includeOptions.map((opt) => {
                            const selected = form.includes.includes(opt.id);
                            const specialist = opt.id === 'specialist';
                            return (
                              <SpringChoice
                                key={opt.id}
                                testId={`button-service-${opt.id}`}
                                label={opt.label}
                                selected={selected}
                                onClick={() => toggleInclude(opt.id)}
                                className="min-h-[124px]"
                              >
                                <img
                                  src={opt.image}
                                  alt=""
                                  className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 ${selected ? 'scale-105' : 'group-hover:scale-105'} ${specialist ? 'opacity-40' : 'opacity-80'}`}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/50 to-transparent" />
                                {specialist && (
                                  <Sparkles className="absolute right-3 top-3 z-10 text-[var(--mb-champagne)]" size={16} />
                                )}
                                <span className="relative z-10 flex h-full min-h-[124px] flex-col justify-between p-3.5">
                                  <SelectedMark selected={selected} />
                                  <span>
                                    <span className="block text-sm font-medium leading-snug text-[var(--mb-ivory)]">{opt.label}</span>
                                    <span className="mt-1 block text-[11px] text-white/60">{opt.blurb}</span>
                                  </span>
                                </span>
                              </SpringChoice>
                            );
                          })}
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
                          <div className="surface-group surface-group-buttons grid gap-2 sm:grid-cols-3">
                            {reachOptions.map((opt) => {
                              const selected = form.reach.includes(opt.id);
                              return (
                                <SpringChoice
                                  key={opt.id}
                                  testId={`button-reach-${opt.id}`}
                                  label={opt.label}
                                  selected={selected}
                                  onClick={() => toggleReach(opt.id)}
                                  className="min-h-[72px] bg-[var(--mb-elevated)]/80"
                                >
                                  <span className="relative z-10 flex items-center gap-3 px-4 py-4">
                                    <SelectedMark selected={selected} />
                                    <opt.Icon size={16} className="text-[var(--mb-champagne)]" />
                                    <span className="text-sm font-medium text-[var(--mb-ivory)]">{opt.label}</span>
                                  </span>
                                </SpringChoice>
                              );
                            })}
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
                      <p
                        data-testid="status-builder-error"
                        className="border-l-2 border-[var(--mb-champagne)] bg-[var(--mb-champagne)]/10 px-4 py-3 text-sm leading-6 text-[var(--mb-ivory)]"
                        role="alert"
                      >
                        {error}
                      </p>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--mb-line)] bg-[var(--mb-charcoal)]/98 px-5 py-4 backdrop-blur-md sm:px-7">
                {stepIndex > 0 ? (
                  <button
                    type="button"
                    data-testid="button-builder-back"
                    onClick={back}
                    className="inline-flex min-h-[44px] items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)] hover:text-[var(--mb-ivory)]"
                  >
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
      </motion.div>
    </div>
  );
}
