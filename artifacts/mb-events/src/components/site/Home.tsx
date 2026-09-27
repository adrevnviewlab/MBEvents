import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, CalendarDays, MoveRight, Pin } from 'lucide-react';
import { A, brand, eventTypes, experiences, galleryItems, reviews, serviceCategories, venues, type EventTypeValue } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Hero() {
  const { openBuilder, openDate, openVenue } = useSiteFunnels();
  return (
    <section className="relative min-h-[100svh] bg-[var(--mb-ink)] text-[var(--mb-ivory)]">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <video
          className="animate-soft-zoom absolute inset-0 h-full w-full object-cover"
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
      </div>
      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl items-end px-5 pb-16 pt-40 sm:px-8 sm:pb-24 lg:px-12">
        <div className="max-w-3xl animate-rise">
          <img src={`${A}mb-events-logo.png`} alt={brand.name} className="mb-8 h-14 w-auto object-contain sm:h-16" />
          <h1 className="max-w-3xl font-display text-[clamp(3.4rem,9vw,7.5rem)] leading-[.86] tracking-[-.04em] text-balance uppercase">
            Your event
            <br />
            <em className="normal-case text-[var(--mb-champagne)]">starts here.</em>
          </h1>
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
          <a href={`tel:${brand.phoneTel}`} className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[.18em] text-[var(--mb-ivory-soft)] hover:text-[var(--mb-champagne)]">
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

function EventTypes() {
  const { openBuilder } = useSiteFunnels();
  return (
    <section id="events" className="bg-[var(--mb-charcoal)] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <SectionEyebrow>01 / Make it yours</SectionEyebrow>
            <h2 className="mt-4 font-display text-5xl leading-none text-[var(--mb-ivory)] sm:text-6xl">Find your kind of night.</h2>
          </div>
          <p className="max-w-xs text-sm leading-6 text-[var(--mb-muted)]">Every celebration has a different pulse. Start with the one that feels most like yours.</p>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((type, i) => {
            const dedicated = type.href !== '/services' && type.href !== '/contact';
            const className = 'group relative block min-h-[260px] overflow-hidden text-left sm:min-h-[280px]';
            const inner = (
              <>
              <img src={type.image} alt={type.label} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/35 to-transparent" />
              <div className="relative flex h-full min-h-[260px] flex-col justify-end p-5 text-[var(--mb-ivory)] sm:min-h-[280px]">
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
                <Link data-testid={`card-event-${i}`} key={type.value} href={type.href} className={className}>
                  {inner}
                </Link>
              );
            }
            return (
            <button
              data-testid={`card-event-${i}`}
              key={type.value}
              onClick={() => openBuilder({ source: 'website_builder', selectedType: type.value as EventTypeValue })}
              className={className}
            >
              {inner}
            </button>
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
    <section id="experiences" className="bg-[var(--mb-ink)] px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
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
        </div>
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {experiences.map((exp, i) => (
            <article key={exp.id} className={`group relative min-h-[420px] overflow-hidden ${i === 1 ? 'lg:translate-y-8' : ''}`}>
              <img src={exp.image} alt={exp.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/50 to-transparent" />
              <div className="relative flex h-full flex-col justify-end p-7">
                <p className="font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">0{i + 1}</p>
                <h3 className="mt-3 font-display text-4xl">{exp.title}</h3>
                <p className="mt-3 max-w-xs text-sm leading-6 text-white/75">{exp.tagline}</p>
                <button
                  data-testid={`button-experience-${exp.id}`}
                  onClick={() => openBuilder({ source: 'experience', experienceId: exp.id })}
                  className="mt-6 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]"
                >
                  Get this experience <MoveRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServicesPreview() {
  const { openBuilder } = useSiteFunnels();
  return (
    <section id="services" className="bg-[var(--mb-surface)] px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow tone="gold">03 / Services</SectionEyebrow>
            <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] sm:text-6xl">
              Six ways we
              <br />
              <em className="text-[var(--mb-champagne)]">shape the night.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Premium groupings — not a messy laundry list. Tap what matters; we’ll map DJ, lighting, photo, and more underneath.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {serviceCategories.map((cat, i) => (
            <button
              key={cat.id}
              type="button"
              data-testid={`card-service-${cat.id}`}
              onClick={() => openBuilder({ source: 'service', serviceIds: [cat.id] })}
              className="group relative min-h-[280px] overflow-hidden text-left"
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
            </button>
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
    <section id="gallery" className="bg-[var(--mb-charcoal)] px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>04 / In the room</SectionEyebrow>
            <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] sm:text-7xl">
              Sparkling light.
              <br />
              <em className="text-[var(--mb-champagne)]">Real nights.</em>
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Sparklers, uplighting, lasers, and dancing on the clouds — footage from actual MB celebrations.</p>
        </div>
        <div className="mt-12 columns-1 gap-4 space-y-4 md:columns-2 lg:columns-3">
          {preview.map((item, i) => (
            <figure key={i} className="group break-inside-avoid overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-elevated)]">
              <div className={`relative overflow-hidden ${item.type === 'video' ? 'aspect-video' : i % 3 === 0 ? 'aspect-[3/4]' : 'aspect-[4/5]'}`}>
                {item.type === 'video' ? (
                  <video data-testid={`video-gallery-${i}`} className="h-full w-full object-cover" controls preload="metadata" poster={item.poster} playsInline>
                    <source src={item.src} type="video/mp4" />
                  </video>
                ) : (
                  <img src={item.src} alt={item.label} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                )}
                <div className="pointer-events-none absolute left-4 top-4 bg-[var(--mb-champagne)] px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-ink)]">{item.label}</div>
              </div>
              <figcaption className="px-5 py-4">
                <span className="font-display text-2xl">{item.caption}</span>
              </figcaption>
            </figure>
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
    <section className="bg-[var(--mb-ink)] px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <SectionEyebrow>The room, after MB</SectionEyebrow>
        <h2 className="mt-4 max-w-xl font-display text-5xl leading-[.94] sm:text-6xl">Same ballroom. Different night.</h2>
        <p className="mt-5 max-w-md text-sm leading-7 text-[var(--mb-muted)]">Drag to see a plain room beside MB lighting and production.</p>
        <div className="relative mt-10 aspect-[16/9] overflow-hidden border border-[var(--mb-line)]">
          <img src={`${import.meta.env.BASE_URL}assets/hero-ballroom.jpg`} alt="Ballroom before production" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <img src={`${import.meta.env.BASE_URL}media/uplighting-ballroom.jpg`} alt="Ballroom with MB uplighting" className="h-full w-full object-cover" />
          </div>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-[var(--mb-champagne)]" style={{ left: `${pos}%` }} />
          <span className="pointer-events-none absolute left-4 top-4 bg-[var(--mb-ink)]/70 px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em]">After</span>
          <span className="pointer-events-none absolute right-4 top-4 bg-[var(--mb-ink)]/70 px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em]">Before</span>
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
    <section className="bg-[var(--mb-charcoal)] px-5 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>On social</SectionEyebrow>
            <h2 className="mt-4 font-display text-4xl text-[var(--mb-ivory)] sm:text-5xl">Clips from the floor.</h2>
          </div>
          <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[.16em]">
            <a href="https://www.instagram.com/mbeventsny/" target="_blank" rel="noreferrer" className="text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">Instagram</a>
            <a href="https://www.tiktok.com/@mbeventsny" target="_blank" rel="noreferrer" className="text-[var(--mb-champagne)] hover:text-[var(--mb-ivory)]">TikTok</a>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {clips.map((c) => (
            <figure key={c.src} className="overflow-hidden border border-[var(--mb-line)]">
              <video className="aspect-[4/5] w-full object-cover md:aspect-video" muted loop playsInline controls poster={c.poster}>
                <source src={c.src} type="video/mp4" />
              </video>
              <figcaption className="px-4 py-3 font-display text-xl text-[var(--mb-ivory)]">{c.caption}</figcaption>
            </figure>
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
    <section id="stories" className="bg-[var(--mb-ink)] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <SectionEyebrow>05 / Reviews</SectionEyebrow>
        <h2 className="mt-5 max-w-2xl font-display text-5xl leading-[.94] text-[var(--mb-ivory)] sm:text-6xl">The best events don’t feel produced.</h2>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--mb-champagne)]">Licensed & insured · Wantagh, NY · Tri-State & destinations</p>
        <div className="mt-12 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <div className="relative min-h-[480px] overflow-hidden bg-[var(--mb-elevated)]">
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
              <blockquote key={r.name} className="flex flex-1 flex-col justify-between border border-[var(--mb-line)] bg-[var(--mb-surface)]/60 p-7">
                <p className="font-display text-2xl leading-snug text-[var(--mb-ivory)]">“{r.quote}”</p>
                <footer className="mt-6 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-muted)]">
                  {r.name} · {r.place}
                </footer>
              </blockquote>
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
  return (
    <section id="venues" className="bg-[var(--mb-charcoal)] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <SectionEyebrow>06 / Venues</SectionEyebrow>
            <h2 className="mt-5 max-w-xl font-display text-5xl leading-[.94] text-[var(--mb-ivory)] sm:text-6xl">Rooms we know by heart.</h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[var(--mb-muted)]">Long Island favorites where our production has filled dance floors for years. Tell us your date — we’ll help match the space.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {venues.slice(0, 4).map((v, i) => (
            <button key={v.name} data-testid={`card-venue-${i}`} onClick={() => openBuilder({ source: 'venue_finder', venueName: v.name })} className="group relative min-h-[280px] overflow-hidden text-left">
              <img src={v.image} alt={v.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/35 to-transparent" />
              <div className="relative flex h-full flex-col justify-end p-5 text-[var(--mb-ivory)]">
                <p className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{v.area}</p>
                <h3 className="mt-2 font-display text-2xl leading-tight">{v.name}</h3>
                <p className="mt-2 text-xs text-white/65">{v.capacity} guests</p>
              </div>
            </button>
          ))}
        </div>
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
      <div className="relative mx-auto flex max-w-7xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
        <div>
          <SectionEyebrow tone="ink">Ready when you are</SectionEyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-5xl leading-none text-[var(--mb-ink)] sm:text-7xl">Check availability. Start building.</h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-[var(--mb-ink)]/70">One conversation is enough to protect your date and sketch the night.</p>
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
      </div>
    </section>
  );
}

function HomeInner() {
  return (
    <main id="top">
      <Hero />
      <Marquee />
      <EventTypes />
      <Experiences />
      <ServicesPreview />
      <GalleryPreview />
      <BeforeAfter />
      <Reviews />
      <SocialRow />
      <VenuesTease />
      <section className="bg-[var(--mb-charcoal)] px-5 py-24 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>After you book</SectionEyebrow>
          <h2 className="mt-4 max-w-xl font-display text-5xl leading-[.94] sm:text-6xl">The night stays in one place.</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {[
              ['/plan/jessica', `${import.meta.env.BASE_URL}media/sparkle-reception.jpg`, 'Planner', 'Countdown, checklist, music, and the people on your team.'],
              ['/e/jessica16', `${import.meta.env.BASE_URL}media/sparkler-entrance-hero-poster.jpg`, 'Invitation', 'One link for the invite, the RSVP, and the night itself.'],
              ['/partners', `${import.meta.env.BASE_URL}media/service-photo.jpg`, 'Partners', 'Photographers, florals, cake, and film we have worked beside.'],
              ['/stories/rob-krista', `${import.meta.env.BASE_URL}media/weddings.jpg`, 'A real night', 'Rob & Krista — then build a celebration in that spirit.'],
            ].map(([href, image, title, text]) => (
              <Link key={href} href={href} className="group relative min-h-[280px] overflow-hidden">
                <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/45 to-transparent" />
                <div className="relative flex h-full min-h-[280px] flex-col justify-end p-7">
                  <h3 className="font-display text-4xl">{title}</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-white/75">{text}</p>
                </div>
              </Link>
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
