import { A, M, partners } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

const shots = [
  `${M}service-photo.jpg`,
  `${M}partner-floral.jpg`,
  `${A}wedding-cake.jpg`,
  `${M}partner-decor.jpg`,
  `${M}partner-film.jpg`,
  `${M}partner-transport.jpg`,
];

function Inner() {
  const { openBuilder } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="MB Partners"
        title={
          <>
            The people around
            <br />
            <em className="text-[var(--mb-champagne)]">the night.</em>
          </>
        }
        subtitle="Photographers, florists, cake, decor, film, and transport we have actually worked beside. MB Verified means we have vetted them — not a legal or quality guarantee."
      />
      <section className="bg-[var(--mb-charcoal)] px-5 py-16 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>Request a quote</SectionEyebrow>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {partners.map((p, i) => (
              <article key={p.name} className="flex flex-col overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-surface)]/50">
                <img src={shots[i % shots.length]} alt="" className="h-40 w-full object-cover" />
                <div className="flex flex-1 flex-col p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{p.category}</p>
                  {p.verified && (
                    <span className="border border-[var(--mb-champagne)] px-2 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-[var(--mb-champagne)]">MB Verified</span>
                  )}
                </div>
                <h2 className="mt-4 font-display text-3xl">{p.name}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--mb-muted)]">{p.blurb}</p>
                <p className="mt-3 text-xs text-[var(--mb-ivory-soft)]">{p.area}</p>
                <Button
                  onClick={() => openBuilder({ source: 'service', note: `Quote request: ${p.name} (${p.category})` })}
                  variant="ghost"
                  testId={`button-partner-${p.name}`}
                  className="mt-6 self-start"
                >
                  Request quote
                </Button>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-8 text-xs text-[var(--mb-muted)]">MB Verified means we have worked with or vetted this partner. It is not a legal, safety, or quality guarantee.</p>
        </div>
      </section>
    </main>
  );
}

export function PartnersPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
