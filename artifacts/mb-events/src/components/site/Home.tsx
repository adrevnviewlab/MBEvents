import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, CalendarDays, MoveRight, Pin } from 'lucide-react';
import { brand, eventTypes, experiences, galleryItems, reviews, serviceCategories, type EventTypeValue } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { SiteShell, useSiteFunnels } from '@/components/site/Layout';
import { SpringCard, Reveal, RevealGroup, revealItem } from '@/components/site/motion';
import { motion } from 'framer-motion';
import { localBusinessJsonLd, usePageMeta } from '@/lib/seo';

function Hero() {
  const { openBuilder, openDate, openVenue } = useSiteFunnels();
  return (
    <section className="relative min-h-[100svh] mb-band text-[var(--mb-ivory)]">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <video
          className="animate-soft-zoom absolute inset-0 h-full w-full scale-[1.02] object-cover [filter:saturate(1.08)_contrast(1.04)_brightness(1.03)]"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={`${import.meta.env.BASE_URL}media/hero-collage-poster.jpg`}
        >
          <source src={`${import.meta.env.BASE_URL}media/hero-collage.mp4`} type="video/mp4" />
        </video>
        <div className="mb-veil absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--mb-ink)]/25 via-transparent to-[var(--mb-ink)]/55" />
      </div>
      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl items-end px-5 pb-16 pt-40 sm:px-8 sm:pb-24 lg:px-12">
        <div className="max-w-3xl animate-rise">
          <SectionEyebrow>Entertainment & production · Long Island</SectionEyebrow>
          <h1 className="mt-5 max-w-3xl font-display text-[clamp(3.4rem,9vw,7.5rem)] leading-[.86] tracking-[-.04em] text-balance uppercase">
            Your event
            <br />
            <em className="normal-case text-[var(--mb-champagne)]">starts here.</em>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-[var(--mb-ivory-soft)]">
            DJ, lighting, and production for weddings, Sweet 16s, and every night that has to feel unforgettable.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button onClick={() => openBuilder()} variant="red" testId="button-hero-build">
              Build my event
            </Button>
            <Button onClick={openDate} variant="outline" testId="button-hero-date" showArrow={false}>
              Check my date
              <CalendarDays size={15} />
            </Button>
            <Button onClick={openVenue} variant="outline" testId="button-hero-venue" showArrow={false}>
              Find a venue
              <Pin size={15} />
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-ivory-soft)]">
            <li>Licensed & insured</li>
            <li>Wantagh, NY</li>
            <li>Tri-State & destinations</li>
          </ul>
          <a href={`tel:${brand.phoneTel}`} className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[.18em] text-[var(--mb-ivory-soft)] hover:text-[var(--mb-champagne)]">
            Or call {brand.phone}
          </a>
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const items = [
    ...eventTypes.map((t) => t.label),
    'Nightclub Energy',
    'Modern Luxury',
    'Full Takeover',
    'Sparklers',
    'Uplighting',
  ];
  const row = [...items, ...items];
  return (
    <div className="overflow-hidden border-y border-[var(--mb-champagne-deep)]/40 bg-[var(--mb-champagne)] py-3.5 text-[var(--mb-ink)]">
      <div className="marquee-track flex w-max items-center gap-10 whitespace-nowrap">
        {row.map((item, i) => (
          <span key={`${item}-${i}`} className="flex items-center gap-10">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[.25em]">{item}</span>
            <span aria-hidden>—</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StatsBar() {
  const stats = [
    ['Licensed', '& fully insured'],
    ['Wantagh, NY', 'Home base'],
    ['Tri-State', '+ destinations'],
    ['By appointment', 'Consultation first'],
  ];
  return (
    <section className="border-b border-[var(--mb-line)] mb-band px-5 py-10 sm:px-8 lg:px-12">
      <RevealGroup className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4" stagger={0.08}>
        {stats.map(([big, label]) => (
          <motion.div key={label} variants={revealItem} className="text-center md:text-left">
            <p className="font-display text-3xl leading-none text-[var(--mb-ivory)] sm:text-4xl">{big}</p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">{label}</p>
          </motion.div>
        ))}
      </RevealGroup>
    </section>
  );
}

function HowItWorks() {
  const { openBuilder } = useSiteFunnels();
  const steps = [
    ['01', 'Tell us the night', 'Event type, date if you have it, and the feeling you want in the room.'],
    ['02', 'Check the date', 'We look at the real calendar. An inquiry does not hold or confirm the night.'],
    ['03', 'Design the room', 'DJ, lighting, photo, and production mapped to one clear plan.'],
    ['04', 'The night itself', 'We run the floor. You stay in the moment.'],
  ];
  return (
    <section className="mb-band px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionEyebrow>How a night comes together</SectionEyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] text-[var(--mb-ivory)] sm:text-6xl">
            From first note
            <br />
            <em className="text-[var(--mb-champagne)]">to last dance.</em>
          </h2>
        </Reveal>
        <RevealGroup className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
          {steps.map(([num, title, text]) => (
            <motion.article
              key={num}
              variants={revealItem}
              className="mb-card group p-6"
            >
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">{num}</p>
              <h3 className="mt-4 font-display text-2xl text-[var(--mb-ivory)]">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--mb-muted)]">{text}</p>
            </motion.article>
          ))}
        </RevealGroup>
        <Reveal className="mt-10" delay={0.12}>
          <Button onClick={() => openBuilder()} variant="outline" testId="button-process-build">
            Start with a conversation
          </Button>
        </Reveal>
      </div>
    </section>
  );
}

function EventTypes() {
  const { openBuilder } = useSiteFunnels();
  return (
    <section id="events" className="mb-band-soft px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <SectionEyebrow>01 / Make it yours</SectionEyebrow>
            <h2 className="mt-4 font-display text-5xl leading-none text-[var(--mb-ivory)] sm:text-6xl">Find your kind of night.</h2>
          </div>
          <p className="max-w-xs text-sm leading-6 text-[var(--mb-muted)]">Every celebration has a different pulse. Start with the one that feels most like yours.</p>
        </Reveal>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((type, i) => {
            const dedicated = type.href !== '/services' && type.href !== '/contact';
            const className = 'mb-card group relative block min-h-[260px] overflow-hidden text-left sm:min-h-[280px]';
            const inner = (
              <>
              <img src={type.image} alt={type.label} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)]/90 via-[var(--mb-ink)]/25 to-transparent" />
              <div className="relative z-[1] flex h-full min-h-[260px] flex-col justify-end p-5 text-[var(--mb-ivory)] sm:min-h-[280px]">
                <span className="mb-10 font-mono text-[10px] text-[var(--mb-champagne)]">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="font-display text-2xl sm:text-3xl">{type.label}</h3>
                <p className="mt-1 text-xs leading-5 text-white/70">{type.blurb}</p>
                <span className="mt-4 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-champagne)] opacity-0 transition-opacity group-hover:opacity-100">
                  {dedicated ? 'See this night' : 'Start here'} <ArrowRight size={14} />
                </span>
              </div>
              </>
            );
            if (dedicated) {
              return (
                <SpringCard key={type.value} href={type.href} label={type.label} testId={`card-event-${i}`} className={className}>
                  {inner}
                </SpringCard>
              );
            }
            return (
              <SpringCard
                key={type.value}
                testId={`card-event-${i}`}
                label={type.label}
                onClick={() => openBuilder({ source: 'website_builder', selectedType: type.value as EventTypeValue })}
                className={className}
              >
                {inner}
              </SpringCard>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Experiences() {
  const { openBuilder } = useSiteFunnels();
  return (
    <section id="experiences" className="mb-band px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow tone="gold">02 / Experiences</SectionEyebrow>
            <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] sm:text-7xl">
              Three ways a room
              <br />
              <em className="text-[var(--mb-champagne)]">comes alive.</em>
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-sm leading-7 text-[var(--mb-muted)]">Nightclub energy, modern luxury, or a full production takeover — pick the feeling, we’ll build the night.</p>
            <Link href="/experiences" className="mt-4 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">
              See all experiences <MoveRight size={14} />
            </Link>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {experiences.map((exp, i) => (
            <SpringCard key={exp.id} className={`mb-card min-h-[420px] overflow-hidden ${i === 1 ? 'lg:translate-y-8' : ''}`}>
              <img src={exp.image} alt={exp.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/50 to-transparent" />
              <div className="relative flex h-full flex-col justify-end p-7">
                <p className="font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">0{i + 1}</p>
                <h3 className="mt-3 font-display text-4xl">{exp.title}</h3>
                <p className="mt-3 max-w-xs text-sm leading-6 text-white/75">{exp.tagline}</p>
                <button
                  data-testid={`button-experience-${exp.id}`}
                  onClick={() => openBuilder({ source: 'experience', experienceId: exp.id })}
                  className="relative z-30 mt-6 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]"
                >
                  Get this experience <MoveRight size={14} />
                </button>
              </div>
            </SpringCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServicesPreview() {
  const { openBuilder } = useSiteFunnels();
  return (
    <section id="services" className="mb-band-soft px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow tone="gold">03 / Services</SectionEyebrow>
            <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] sm:text-6xl">
              Six ways we
              <br />
              <em className="text-[var(--mb-champagne)]">shape the night.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Premium groupings — not a messy laundry list. Tap what matters; we’ll map DJ, lighting, photo, and more underneath.</p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {serviceCategories.map((cat, i) => (
            <SpringCard
              key={cat.id}
              testId={`card-service-${cat.id}`}
              label={cat.title}
              onClick={() => openBuilder({ source: 'service', serviceIds: [cat.id] })}
              className="mb-card min-h-[280px] overflow-hidden text-left"
            >
              <img src={cat.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/55 to-transparent" />
              <div className="relative flex h-full flex-col justify-end p-6">
                <span className="font-mono text-[10px] text-[var(--mb-champagne)]">0{i + 1}</span>
                <h3 className="mt-2 font-display text-3xl">{cat.title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/70">{cat.tagline}</p>
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[.12em] text-white/45 opacity-0 transition-opacity group-hover:opacity-100">
                  {cat.items.slice(0, 4).join(' · ')}
                </p>
              </div>
            </SpringCard>
          ))}
        </div>
        <div className="mt-10">
          <Link
            href="/services"
            data-testid="button-services-all"
            className="group inline-flex items-center justify-center gap-3 border border-[var(--mb-ivory)]/45 px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ivory)] transition-all hover:border-[var(--mb-champagne)] hover:text-[var(--mb-champagne)]"
          >
            Explore services
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function GalleryPreview() {
  const preview = galleryItems.slice(0, 6);
  return (
    <section id="gallery" className="mb-band-soft px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>04 / In the room</SectionEyebrow>
            <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] sm:text-7xl">
              Sparkling light.
              <br />
              <em className="text-[var(--mb-champagne)]">Real nights.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Sparklers, lasers, haze, and a packed dance floor — mixed with recaps from real MB celebrations.</p>
        </Reveal>
        <div className="mt-12 columns-1 gap-4 md:columns-2 lg:columns-3">
          {preview.map((item, i) => (
            <SpringCard key={i} tilt={4} lift={-6} className="mb-card mb-4 break-inside-avoid overflow-hidden">
              <div className={`relative overflow-hidden ${item.type === 'video' ? 'aspect-video' : i % 3 === 0 ? 'aspect-[3/4]' : 'aspect-[4/5]'}`}>
                {item.type === 'video' ? (
                  <video data-testid={`video-gallery-${i}`} className="h-full w-full object-cover" controls preload="metadata" poster={item.poster} playsInline>
                    <source src={item.src} type="video/mp4" />
                  </video>
                ) : (
                  <img src={item.src} alt={item.label} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                )}
                <div className="pointer-events-none absolute left-4 top-4 z-10 bg-[var(--mb-champagne)] px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-ink)]">{item.label}</div>
              </div>
              <figcaption className="px-5 py-4">
                <span className="font-display text-2xl">{item.caption}</span>
              </figcaption>
            </SpringCard>
          ))}
        </div>
        <div className="mt-10">
          <Link href="/gallery" className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">
            Full gallery <MoveRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function BeforeAfter() {
  const [pos, setPos] = useState(58);
  return (
    <section className="mb-band px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionEyebrow>The room, after MB</SectionEyebrow>
          <h2 className="mt-4 max-w-xl font-display text-5xl leading-[.94] sm:text-6xl">Same ballroom. Different night.</h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-[var(--mb-muted)]">Drag to see a plain room beside MB lighting and production.</p>
        </Reveal>
        <div className="relative mt-10 aspect-[16/9] overflow-hidden border border-[var(--mb-line)]">
          <img src={`${import.meta.env.BASE_URL}assets/hero-ballroom.jpg`} alt="Ballroom before production" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <img src={`${import.meta.env.BASE_URL}media/uplighting-ballroom.jpg`} alt="Ballroom with MB uplighting" className="h-full w-full object-cover" />
          </div>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-[var(--mb-champagne)]" style={{ left: `${pos}%` }} />
          <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-[var(--mb-ink)]/55 px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] backdrop-blur-md">After</span>
          <span className="pointer-events-none absolute right-4 top-4 rounded-full bg-[var(--mb-ink)]/55 px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] backdrop-blur-md">Before</span>
          <input
            data-testid="slider-before-after"
            type="range"
            min={8}
            max={92}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Compare before and after"
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>
      </div>
    </section>
  );
}

function SocialRow() {
  const clips = galleryItems.filter((g) => g.type === 'video').slice(0, 3);
  return (
    <section className="mb-band-soft px-5 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>On social</SectionEyebrow>
            <h2 className="mt-4 font-display text-4xl text-[var(--mb-ivory)] sm:text-5xl">Clips from the floor.</h2>
          </div>
          <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[.16em]">
            <a href="https://www.instagram.com/mbeventsny/" target="_blank" rel="noreferrer" className="text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">Instagram</a>
            <a href="https://www.tiktok.com/@mbeventsny" target="_blank" rel="noreferrer" className="text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">TikTok</a>
          </div>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {clips.map((c) => (
            <SpringCard key={c.src} tilt={4} lift={-6} className="overflow-hidden">
              <video className="aspect-[4/5] w-full object-cover md:aspect-video" muted loop playsInline controls poster={c.poster}>
                <source src={c.src} type="video/mp4" />
              </video>
              <figcaption className="px-4 py-3 font-display text-xl text-[var(--mb-ivory)]">{c.caption}</figcaption>
            </SpringCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function Reviews() {
  const { openBuilder } = useSiteFunnels();
  const featured = reviews[0];
  return (
    <section id="stories" className="mb-band px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionEyebrow>05 / Reviews</SectionEyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] text-[var(--mb-ivory)] sm:text-6xl">The best events don’t feel produced.</h2>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">Licensed & insured · Wantagh, NY · Tri-State & destinations</p>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <div className="mb-glass relative min-h-[480px] overflow-hidden rounded-2xl">
            <img src={featured.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/35 to-transparent" />
            <div className="absolute bottom-0 left-0 max-w-2xl p-7 text-[var(--mb-ivory)] sm:p-10">
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">A client note</p>
              <p className="mt-4 font-display text-3xl leading-[1.08] sm:text-4xl">“{featured.quote}”</p>
              <p className="mt-5 text-xs text-white/70">
                — {featured.name}, {featured.place}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {reviews.slice(1, 3).map((r) => (
              <SpringCard key={r.name} tilt={4} lift={-6} className="mb-card flex flex-1 flex-col justify-between p-7">
                <p className="font-display text-2xl leading-snug text-[var(--mb-ivory)]">“{r.quote}”</p>
                <footer className="mt-6 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-muted)]">
                  {r.name} · {r.place}
                </footer>
              </SpringCard>
            ))}
            <button data-testid="button-story-inquiry" onClick={() => openBuilder()} className="mt-2 flex items-center gap-3 border-b border-[var(--mb-ivory)]/40 pb-3 text-left text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ivory)] hover:border-[var(--mb-champagne)] hover:text-[var(--mb-champagne)]">
              Start a conversation <MoveRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function VenuesTease() {
  const { openVenue, openBuilder } = useSiteFunnels();
  const [live, setLive] = useState<{ id: string; name: string; area: string; capacity: string; photos: { url: string }[] }[] | null>(null);
  useEffect(() => {
    let gone = false;
    fetch('/api/venues')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { venues?: { id: string; name: string; area: string; capacity: string; photos: { url: string }[] }[] } | null) => {
        if (gone || !body?.venues?.length) {
          if (!gone) setLive([]);
          return;
        }
        setLive(body.venues.slice(0, 4));
      })
      .catch(() => { if (!gone) setLive([]); });
    return () => { gone = true; };
  }, []);
  return (
    <section id="venues" className="mb-band-soft px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>06 / Venues</SectionEyebrow>
            <h2 className="mt-5 max-w-xl font-display text-5xl leading-[.94] text-[var(--mb-ivory)] sm:text-6xl">Rooms we know by heart.</h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Published venues from our directory. Tell us your date — we’ll help match the space. Listing a room does not mean a date is held.</p>
        </Reveal>
        {live === null ? (
          <p className="mt-12 text-sm text-[var(--mb-muted)]">Loading venues…</p>
        ) : live.length ? (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {live.map((v, i) => (
              <SpringCard key={v.id} testId={`card-venue-${i}`} label={v.name} onClick={() => openBuilder({ source: 'venue_finder', venueName: v.name, venueId: v.id })} className="min-h-[280px] overflow-hidden text-left">
                {v.photos[0] ? (
                  <img src={v.photos[0].url} alt={v.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="absolute inset-0 bg-[var(--mb-charcoal)]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/35 to-transparent" />
                <div className="relative flex h-full flex-col justify-end p-5 text-[var(--mb-ivory)]">
                  <p className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{v.area || 'Long Island'}</p>
                  <h3 className="mt-2 font-display text-2xl leading-tight">{v.name}</h3>
                  {v.capacity ? <p className="mt-2 text-xs text-white/65">{v.capacity} guests</p> : null}
                </div>
              </SpringCard>
            ))}
          </div>
        ) : (
          <p className="mt-12 max-w-lg text-sm leading-7 text-[var(--mb-muted)]">Published venue listings will appear here. Ask us for rooms that fit your date and guest count.</p>
        )}
        <div className="mt-10 flex flex-wrap gap-3">
          <Button onClick={openVenue} variant="outline" testId="button-venues-cta" showArrow={false}>
            Find a venue
            <Pin size={15} />
          </Button>
          <Link href="/venues" className="inline-flex items-center gap-2 px-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">
            Venue directory <MoveRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const { openBuilder, openDate } = useSiteFunnels();
  return (
    <section className="relative overflow-hidden bg-[var(--mb-champagne)] px-5 py-24 sm:px-8 lg:px-12 lg:py-28">
      <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border border-[var(--mb-ink)]/15" />
      <div className="absolute -right-4 -top-10 h-52 w-52 rounded-full border border-[var(--mb-ink)]/15" />
      <Reveal className="relative mx-auto flex max-w-7xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
        <div>
          <SectionEyebrow tone="ink">Ready when you are</SectionEyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-5xl leading-none text-[var(--mb-ink)] sm:text-7xl">Check availability. Start building.</h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-[var(--mb-ink)]/70">One conversation starts the plan. A date is only reserved after MB Events confirms a booking.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => openBuilder()} variant="dark" testId="button-footer-build" className="!bg-[var(--mb-ink)] !text-[var(--mb-ivory)] hover:!bg-[var(--mb-charcoal)]">
            Build my event
          </Button>
          <Button onClick={openDate} variant="ghost" testId="button-footer-date" showArrow={false} className="!border-[var(--mb-ink)]/30 !text-[var(--mb-ink)] hover:!border-[var(--mb-ink)] hover:!text-[var(--mb-ink)]">
            Check my date
            <CalendarDays size={15} />
          </Button>
        </div>
      </Reveal>
    </section>
  );
}

function HomeInner() {
  usePageMeta({
    title: 'MB Events | Long Island Event Entertainment & Production',
    description: brand.about,
    path: '/',
    jsonLd: localBusinessJsonLd(),
  });
  return (
    <main id="top">
      <Hero />
      <Marquee />
      <StatsBar />
      <HowItWorks />
      <EventTypes />
      <Experiences />
      <ServicesPreview />
      <GalleryPreview />
      <BeforeAfter />
      <Reviews />
      <SocialRow />
      <VenuesTease />
      <section className="mb-band-soft px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <SectionEyebrow>After you book</SectionEyebrow>
            <h2 className="mt-4 max-w-xl font-display text-5xl leading-[.94] sm:text-6xl">The night stays in one place.</h2>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {[
              ['/planner', `${import.meta.env.BASE_URL}media/service-planning.jpg`, 'Client planner', 'Your timeline, checklist, music, and messages in one private space.'],
              ['/services', `${import.meta.env.BASE_URL}media/sparkler-entrance-hero-poster.jpg`, 'Production', 'Sound, lighting, and entertainment designed for your room.'],
              ['/partners', `${import.meta.env.BASE_URL}media/partner-floral.jpg`, 'Partners', 'Photographers, florals, cake, and film we have worked beside.'],
              ['/stories/rob-krista', `${import.meta.env.BASE_URL}media/weddings.jpg`, 'A real night', 'Rob & Krista — then build a celebration in that spirit.'],
            ].map(([href, image, title, text]) => (
              <SpringCard key={href} href={href} label={title} className="min-h-[280px] overflow-hidden">
                <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/45 to-transparent" />
                <div className="relative flex h-full min-h-[280px] flex-col justify-end p-7">
                  <h3 className="font-display text-4xl">{title}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-white/75">{text}</p>
                </div>
              </SpringCard>
            ))}
          </div>
        </div>
      </section>
      <FinalCta />
    </main>
  );
}

export function Home() {
  return (
    <SiteShell>
      <HomeInner />
    </SiteShell>
  );
}
