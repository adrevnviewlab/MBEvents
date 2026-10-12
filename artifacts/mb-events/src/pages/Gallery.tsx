import { galleryItems, M } from '@/lib/content';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="Gallery"
        title={
          <>
            See the feeling
            <br />
            <em className="text-[var(--mb-champagne)]">in motion.</em>
          </>
        }
        subtitle="Production looks — sparkler glow, wedding recaps, haze and lasers, packed dance floors, and warm ballroom uplighting. Named recaps are from real MB nights."
        image={`${M}sparkler-entrance-poster.jpg`}
      />
      <section className="bg-[var(--mb-charcoal)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-7xl columns-1 gap-4 space-y-4 md:columns-2 lg:columns-3">
          {galleryItems.map((item, i) => (
            <figure key={i} className="group break-inside-avoid overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-elevated)]">
              <div className={`relative overflow-hidden ${item.type === 'video' ? 'aspect-video' : 'aspect-[4/5]'}`}>
                {item.type === 'video' ? (
                  <video data-testid={`video-portfolio-${i}`} className="h-full w-full object-cover" controls preload="metadata" poster={item.poster} playsInline>
                    <source src={item.src} type="video/mp4" />
                  </video>
                ) : (
                  <img src={item.src} alt={item.label} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                )}
                <div className="pointer-events-none absolute left-4 top-4 bg-[var(--mb-champagne)] px-3 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-ink)]">{item.label}</div>
              </div>
              <figcaption className="flex items-center justify-between gap-3 px-5 py-4">
                <span className="font-display text-2xl">{item.caption}</span>
                <button
                  type="button"
                  data-testid={`button-build-look-${i}`}
                  onClick={() => openBuilder({ note: item.caption, selectedType: item.caption.toLowerCase().includes('sweet') ? 'Sweet 16' : 'Wedding' })}
                  className="shrink-0 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-champagne)]"
                >
                  Build this look
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}

export function GalleryPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
