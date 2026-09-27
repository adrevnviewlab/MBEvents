import { Link } from 'wouter';
import { MoveRight } from 'lucide-react';
import { experiences, M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="Experiences"
        title={
          <>
            Pick the feeling.
            <br />
            <em className="text-[var(--mb-champagne)]">We’ll build the night.</em>
          </>
        }
        subtitle="Three production directions drawn from how MB Events actually transforms rooms — from lasers to soft luxury to full takeover."
        image={`${M}laser-dance-poster.jpg`}
      />
      <section className="bg-[var(--mb-charcoal)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto flex max-w-7xl flex-col gap-16">
          {experiences.map((exp, i) => (
            <article key={exp.id} className={`grid gap-8 lg:grid-cols-2 lg:items-center ${i % 2 === 1 ? 'lg:[&>div:first-child]:order-2' : ''}`}>
              <div className="relative min-h-[320px] overflow-hidden sm:min-h-[420px]">
                <img src={exp.image} alt={exp.title} className="absolute inset-0 h-full w-full object-cover" />
              </div>
              <div className="text-[var(--mb-ivory)]">
                <SectionEyebrow tone="gold">0{i + 1} / {exp.title}</SectionEyebrow>
                <h2 className="mt-4 font-display text-4xl sm:text-5xl">{exp.title}</h2>
                <p className="mt-4 text-lg text-[var(--mb-champagne)]">{exp.tagline}</p>
                <p className="mt-5 max-w-lg text-sm leading-7 text-[var(--mb-muted)]">{exp.detail}</p>
                <ul className="mt-6 space-y-2">
                  {exp.includes.map((item) => (
                    <li key={item} className="font-mono text-[10px] uppercase tracking-[.14em] text-white/55">
                      — {item}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => openBuilder({ source: 'experience', experienceId: exp.id })}
                  variant="red"
                  testId={`button-get-experience-${exp.id}`}
                  className="mt-8"
                >
                  Get this experience
                </Button>
              </div>
            </article>
          ))}
        </div>
        <div className="mx-auto mt-16 max-w-7xl border-t border-[var(--mb-line)] pt-10">
          <Link href="/services" className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)]">
            Or browse services <MoveRight size={14} />
          </Link>
        </div>
      </section>
    </main>
  );
}

export function ExperiencesPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
