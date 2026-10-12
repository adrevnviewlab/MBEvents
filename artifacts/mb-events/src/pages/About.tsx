import { Link } from 'wouter';
import { ArrowUpRight, CalendarDays, Mic2, Sparkles } from 'lucide-react';
import { brand, M } from '@/lib/content';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';
import { Button, SectionEyebrow } from '@/components/site/ui';

function AboutContent() {
  const { openBuilder, openDate } = useSiteFunnels();

  return (
    <main>
      <PageHero
        eyebrow="About us"
        title={
          <>
            Built for the moments
            <br />
            <em className="text-[var(--mb-champagne)]">that stay with you.</em>
          </>
        }
        subtitle={`${brand.name} is based on Long Island, New York. We bring DJ entertainment, hosting, sound, and lighting together for weddings, milestone celebrations, corporate events, and private parties.`}
        image={`${M}sparkler-entrance-hero-poster.jpg`}
      >
        <Button onClick={openDate} variant="red" testId="button-about-date">
          Check my date
        </Button>
      </PageHero>

      <section className="bg-[var(--mb-charcoal)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div className="relative aspect-[4/3] overflow-hidden">
            <img
              src={`${M}uplighting-ballroom.jpg`}
              alt="Event room illuminated with production lighting"
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)]/35 to-transparent" />
          </div>
          <div>
            <SectionEyebrow>Our point of view</SectionEyebrow>
            <h2 className="mt-5 max-w-xl font-display text-4xl leading-tight sm:text-5xl">
              More than a playlist.
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-7 text-[var(--mb-ivory-soft)]">
              {brand.goal}
            </p>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--mb-muted)]">
              The music, the lighting, and the way a room moves all matter. Explore the different
              directions for your event, then tell us what feels like you.
            </p>
            <Link
              href="/experiences"
              className="mt-8 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] transition-colors hover:text-[var(--mb-ivory)]"
            >
              Explore experiences <ArrowUpRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[var(--mb-ink)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>What we bring together</SectionEyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">
            A night with every detail in conversation.
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <article className="border border-[var(--mb-line)] bg-[var(--mb-surface)]/40 p-7">
              <Mic2 size={24} strokeWidth={1.5} className="text-[var(--mb-champagne)]" aria-hidden />
              <h3 className="mt-7 font-display text-2xl">Music &amp; hosting</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--mb-muted)]">
                DJ and MC options help shape the pace and energy of your celebration.
              </p>
            </article>
            <article className="border border-[var(--mb-line)] bg-[var(--mb-surface)]/40 p-7">
              <Sparkles size={24} strokeWidth={1.5} className="text-[var(--mb-champagne)]" aria-hidden />
              <h3 className="mt-7 font-display text-2xl">Sound &amp; lighting</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--mb-muted)]">
                Production choices set the atmosphere and bring your room into focus.
              </p>
            </article>
            <article className="border border-[var(--mb-line)] bg-[var(--mb-surface)]/40 p-7">
              <CalendarDays size={24} strokeWidth={1.5} className="text-[var(--mb-champagne)]" aria-hidden />
              <h3 className="mt-7 font-display text-2xl">A clearer starting point</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--mb-muted)]">
                Share your date, venue, and priorities so we can begin a focused conversation.
              </p>
            </article>
          </div>
          <Link
            href="/services"
            className="mt-9 inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)] transition-colors hover:text-[var(--mb-ivory)]"
          >
            Browse services <ArrowUpRight size={16} aria-hidden />
          </Link>
        </div>
      </section>

      <section className="border-t border-[var(--mb-line)] bg-[var(--mb-surface)] px-5 py-20 text-center text-[var(--mb-ivory)] sm:px-8 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <SectionEyebrow>Start here</SectionEyebrow>
          <h2 className="mt-5 font-display text-4xl sm:text-5xl">Tell us what you’re imagining.</h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[var(--mb-muted)]">
            Choose a date to start the conversation, or build out the ideas you already have.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={openDate} variant="red" testId="button-about-date-final">
              Check my date
            </Button>
            <Button onClick={() => openBuilder()} variant="outline" testId="button-about-build">
              Build my event
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

export function AboutPage() {
  return (
    <SiteShell solidHeader>
      <AboutContent />
    </SiteShell>
  );
}
