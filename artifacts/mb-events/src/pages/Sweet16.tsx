import { A, sweet16Copy, M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder, openDate } = useSiteFunnels();

  return (
    <main>
      <PageHero
        eyebrow={sweet16Copy.eyebrow}
        title={
          <>
            {sweet16Copy.title}
            <br />
            <em className="text-[var(--mb-champagne)]">done right.</em>
          </>
        }
        subtitle={sweet16Copy.lead}
        image={`${A}sweet-sixteen.jpg`}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => openBuilder({ selectedType: 'Sweet 16' })} variant="red" testId="button-sweet16-build">
            Build this Sweet 16
          </Button>
          <Button onClick={openDate} variant="outline" testId="button-sweet16-date" showArrow={false}>
            Check my date
          </Button>
        </div>
      </PageHero>

      <section className="bg-[var(--mb-charcoal)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionEyebrow>Unforgettable nights</SectionEyebrow>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl">Club energy. Their soundtrack.</h2>
            <p className="mt-6 text-sm leading-7 text-[var(--mb-muted)]">{sweet16Copy.body}</p>
            <ul className="mt-8 space-y-3">
              {sweet16Copy.bullets.map((b) => (
                <li key={b} className="border-l-2 border-[var(--mb-champagne)] pl-4 font-mono text-[10px] uppercase tracking-[.14em] text-[var(--mb-ivory-soft)]">
                  {b}
                </li>
              ))}
            </ul>
            <Button onClick={() => openBuilder({ source: 'experience', selectedType: 'Sweet 16', experienceId: 'nightclub' })} variant="red" testId="button-sweet16-nightclub" className="mt-8">
              Get nightclub energy
            </Button>
          </div>
          <div className="relative min-h-[380px] overflow-hidden">
            <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline poster={`${M}laser-dance-poster.jpg`}>
              <source src={`${M}laser-dance.mp4`} type="video/mp4" />
            </video>
          </div>
        </div>
      </section>
    </main>
  );
}

export function Sweet16Page() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
