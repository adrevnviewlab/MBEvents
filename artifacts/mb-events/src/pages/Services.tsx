import { serviceCategories, M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="Services"
        title={
          <>
            Premium production —
            <br />
            <em className="text-[var(--mb-champagne)]">organized clearly.</em>
          </>
        }
        subtitle="We don’t dump every line item on you. Six customer-facing categories map everything from DJ & MC to lasers, photo booths, casino nights, and day-of coordination."
        image={`${M}service-lighting.jpg`}
      />
      <section className="bg-[var(--mb-charcoal)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
          {serviceCategories.map((cat, i) => (
            <article key={cat.id} id={cat.id} className="overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-surface)]/50">
              <div className="relative aspect-[16/9] overflow-hidden sm:aspect-[21/9]">
                <img src={cat.image} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)]/90 to-transparent" />
                <div className="absolute bottom-0 left-0 p-6">
                  <SectionEyebrow tone="gold">0{i + 1}</SectionEyebrow>
                  <h2 className="mt-2 font-display text-3xl text-[var(--mb-ivory)] sm:text-4xl">{cat.title}</h2>
                </div>
              </div>
              <div className="p-6 sm:p-8">
                <p className="text-sm leading-7 text-[var(--mb-muted)]">{cat.detail}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {cat.items.map((item) => (
                    <span key={item} className="border border-[var(--mb-line)] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-[var(--mb-ivory-soft)]">
                      {item}
                    </span>
                  ))}
                </div>
                <Button
                  onClick={() => openBuilder({ source: 'service', serviceIds: [cat.id] })}
                  variant="outline"
                  testId={`button-service-build-${cat.id}`}
                  className="mt-7"
                >
                  Add to my event
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export function ServicesPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
