import { useState } from 'react';
import { Link } from 'wouter';
import { A, M } from '@/lib/content';
import { SiteShell, useSiteFunnels } from '@/components/site/Layout';

function InviteInner() {
  const { openBuilder, openDate } = useSiteFunnels();
  const [rsvp, setRsvp] = useState<'in' | 'out' | 'listed' | null>(null);
  const [guest, setGuest] = useState({ name: '', phone: '', party: '1', song: '' });
  const maps = 'https://maps.google.com/?q=Crest+Hollow+Country+Club+Woodbury+NY';
  const cal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Jessica%27s+Sweet+16&dates=20260620T000000Z/20260620T040000Z&location=Crest%20Hollow%20Country%20Club';

  return (
    <main className="bg-[var(--mb-ink)] text-[var(--mb-ivory)]">
      <section className="relative min-h-[78svh]">
        <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline poster={`${M}sparkler-entrance-hero-poster.jpg`}>
          <source src={`${M}sparkler-entrance-hero.mp4`} type="video/mp4" />
        </video>
        <div className="mb-veil absolute inset-0" />
        <div className="relative mx-auto flex min-h-[78svh] max-w-3xl flex-col justify-end px-5 pb-16 pt-36 sm:px-8">
          <img src={`${A}mb-events-logo.png`} alt="MB Events" className="mb-8 h-10 w-auto object-contain" />
          <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">You are invited</p>
          <h1 className="mt-3 font-display text-6xl leading-[.9] sm:text-8xl">Jessica’s Sweet 16</h1>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[.16em] text-[var(--mb-ivory-soft)]">Saturday, June 19 · 7:00 PM</p>
          <p className="mt-2 text-sm text-[var(--mb-ivory-soft)]">Crest Hollow Country Club · Woodbury, NY</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <p className="text-sm leading-7 text-[var(--mb-muted)]">
          Dinner, a grand entrance, and a dance floor that stays open until the last song. Dress to celebrate. This is a sample invitation — one link for the invite, the night, and the memories after.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button data-testid="button-invite-rsvp" onClick={() => setRsvp('in')} className="bg-[var(--mb-champagne)] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)]">
            I’m coming
          </button>
          <button data-testid="button-invite-decline" onClick={() => setRsvp('out')} className="border border-[var(--mb-ivory)]/40 px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em]">
            Can’t make it
          </button>
          <a href={cal} target="_blank" rel="noreferrer" className="border border-[var(--mb-ivory)]/40 px-5 py-3 text-center text-[11px] font-extrabold uppercase tracking-[.16em]">
            Add to calendar
          </a>
          <a href={maps} target="_blank" rel="noreferrer" className="border border-[var(--mb-ivory)]/40 px-5 py-3 text-center text-[11px] font-extrabold uppercase tracking-[.16em]">
            Get directions
          </a>
        </div>
        {rsvp === 'out' && (
          <p className="mt-6 text-sm text-[var(--mb-muted)]">We’ll miss you. Jessica still has a seat saved in spirit.</p>
        )}
        {rsvp === 'in' && (
          <form
            className="mt-6 space-y-4 border border-[var(--mb-line)] p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!guest.name.trim()) return;
              setRsvp('listed');
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">Party of up to 2</p>
            <input required value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} placeholder="Your name" className="h-12 w-full border border-[var(--mb-line-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--mb-champagne)]" />
            <input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="Phone" className="h-12 w-full border border-[var(--mb-line-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--mb-champagne)]" />
            <div className="flex gap-2">
              {['1', '2'].map((n) => (
                <button key={n} type="button" onClick={() => setGuest({ ...guest, party: n })} className={`px-4 py-3 text-xs font-bold uppercase tracking-widest ${guest.party === n ? 'bg-[var(--mb-champagne)] text-[var(--mb-ink)]' : 'border border-[var(--mb-line)]'}`}>
                  {n} {n === '1' ? 'guest' : 'guests'}
                </button>
              ))}
            </div>
            <input value={guest.song} onChange={(e) => setGuest({ ...guest, song: e.target.value })} placeholder="What song gets you on the floor?" className="h-12 w-full border border-[var(--mb-line-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--mb-champagne)]" />
            <button type="submit" className="bg-[var(--mb-champagne)] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)]">
              Confirm RSVP
            </button>
          </form>
        )}
        {rsvp === 'listed' && (
          <p data-testid="status-invite-rsvp" className="mt-6 border border-[var(--mb-champagne)]/40 bg-[var(--mb-champagne)]/10 px-4 py-4 font-display text-3xl">
            You’re on the list.
          </p>
        )}
        <div className="mt-14 border-t border-[var(--mb-line)] pt-10">
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">Want MB at your event?</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button data-testid="button-invite-build" onClick={() => openBuilder({ selectedType: 'Sweet 16' })} className="bg-[var(--mb-champagne)] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)]">
              Plan my event with MB
            </button>
            <button data-testid="button-invite-date" onClick={openDate} className="border border-[var(--mb-ivory)]/40 px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em]">
              Check my date
            </button>
          </div>
          <Link href="/" className="mt-8 inline-block text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)] hover:text-[var(--mb-champagne)]">
            Back to MB Events
          </Link>
        </div>
      </section>
    </main>
  );
}

export function InvitePage() {
  return (
    <SiteShell solidHeader>
      <InviteInner />
    </SiteShell>
  );
}
