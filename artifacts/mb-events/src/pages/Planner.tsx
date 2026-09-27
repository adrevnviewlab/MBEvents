import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { sweet16Checklist } from '@/lib/content';
import { SiteShell } from '@/components/site/Layout';

const sections = ['Overview', 'Checklist', 'Guests', 'Music', 'Timeline', 'Team'] as const;
type Section = (typeof sections)[number];

const guests = [
  { name: 'Sarah Ahmed', status: 'Going', extra: '+1', note: '' },
  { name: 'Daniel Ruiz', status: 'Going', extra: '', note: 'Vegetarian' },
  { name: 'Maya Chen', status: 'Pending', extra: '', note: '' },
  { name: 'Owen Blake', status: 'Declined', extra: '', note: '' },
  { name: 'Priya Shah', status: 'Going', extra: '+1', note: 'Song: Levitating' },
];

const timeline = [
  ['5:00', 'Vendors arrive'],
  ['6:00', 'Photography'],
  ['6:30', 'Doors open'],
  ['7:00', 'Grand entrance'],
  ['7:15', 'Dinner'],
  ['8:00', 'Speeches'],
  ['8:30', 'Dancing'],
  ['9:30', 'Cake'],
  ['11:00', 'Event ends'],
];

function daysUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function Inner() {
  const [section, setSection] = useState<Section>('Overview');
  const [tasks, setTasks] = useState(sweet16Checklist);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const done = tasks.filter((t) => t.done).length;
  const progress = Math.round((done / tasks.length) * 100);
  const days = useMemo(() => daysUntil('2027-06-19'), []);
  const visible = guests.filter((g) => (filter === 'All' || g.status === filter) && g.name.toLowerCase().includes(query.toLowerCase()));

  const exportCsv = () => {
    const csv = ['Name,Status,Plus one,Note', ...guests.map((g) => `${g.name},${g.status},${g.extra},${g.note}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jessica-guests.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="bg-[var(--mb-ink)] px-5 pb-20 pt-28 text-[var(--mb-ivory)] sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">MB Planner</p>
        <h1 className="mt-3 font-display text-5xl sm:text-7xl">Jessica’s Sweet 16</h1>
        <p className="mt-4 font-display text-3xl text-[var(--mb-champagne)]">{days} days to go</p>
        <div className="mt-6 h-2 w-full bg-[var(--mb-elevated)]">
          <div className="h-full bg-[var(--mb-champagne)]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-muted)]">Planning progress {progress}%</p>

        <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`shrink-0 px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.14em] ${section === s ? 'bg-[var(--mb-champagne)] text-[var(--mb-ink)]' : 'border border-[var(--mb-line)] text-[var(--mb-ivory)]'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {section === 'Overview' && (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Due this week', 'Finalize invitation'],
              ['Next', 'Choose lighting package'],
              ['Then', 'Confirm photographer'],
            ].map(([k, v]) => (
              <div key={k} className="border border-[var(--mb-line)] p-5">
                <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{k}</p>
                <p className="mt-3 font-display text-2xl">{v}</p>
              </div>
            ))}
          </div>
        )}

        {section === 'Checklist' && (
          <ul className="mt-8 space-y-2">
            {tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTasks((list) => list.map((item) => (item.id === t.id ? { ...item, done: !item.done } : item)))}
                  className="flex w-full items-center gap-3 border border-[var(--mb-line)] px-4 py-3 text-left"
                >
                  <span className={`flex h-5 w-5 items-center justify-center border ${t.done ? 'border-[var(--mb-champagne)] bg-[var(--mb-champagne)] text-[var(--mb-ink)]' : 'border-[var(--mb-line-strong)]'}`}>{t.done ? '✓' : ''}</span>
                  <span className={t.done ? 'text-[var(--mb-muted)] line-through' : ''}>{t.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {section === 'Guests' && (
          <div className="mt-8">
        <div className="grid grid-cols-3 gap-3">
          {[
            ['112', 'Going'],
            ['19', 'Pending'],
            ['16', 'Declined'],
          ].map(([n, label]) => (
            <div key={label} className="border border-[var(--mb-line)] px-4 py-5">
              <p className="font-display text-4xl text-[var(--mb-champagne)]">{n}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-muted)]">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-[var(--mb-muted)]">147 invited. A few names from the list:</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['All', 'Going', 'Pending', 'Declined'].map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.12em] ${filter === f ? 'bg-[var(--mb-champagne)] text-[var(--mb-ink)]' : 'border border-[var(--mb-line)]'}`}>{f}</button>
              ))}
              <button type="button" onClick={exportCsv} className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-[var(--mb-champagne)]">Export CSV</button>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guests" className="mt-4 h-12 w-full border border-[var(--mb-line-strong)] bg-transparent px-4 text-sm outline-none focus:border-[var(--mb-champagne)]" />
            <ul className="mt-4 divide-y divide-[var(--mb-line)] border border-[var(--mb-line)]">
              {visible.map((g) => (
                <li key={g.name} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>{g.name}</span>
                  <span className="text-[var(--mb-muted)]">{g.status}{g.extra ? ` · ${g.extra}` : ''}{g.note ? ` · ${g.note}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {section === 'Music' && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {['Must play', 'Do not play', 'Entrance songs', 'First dance', 'Cake song', 'Last song'].map((label) => (
              <label key={label} className="block text-sm">
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{label}</span>
                <input className="mt-2 h-12 w-full border border-[var(--mb-line-strong)] bg-transparent px-4 outline-none focus:border-[var(--mb-champagne)]" placeholder="Add a song" />
              </label>
            ))}
          </div>
        )}

        {section === 'Timeline' && (
          <ol className="mt-8 space-y-3">
            {timeline.map(([time, label]) => (
              <li key={time} className="flex gap-4 border-l border-[var(--mb-champagne)] pl-4">
                <span className="w-14 font-mono text-xs text-[var(--mb-champagne)]">{time}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        )}

        {section === 'Team' && (
          <ul className="mt-8 space-y-3">
            {[
              ['Venue', 'Crest Hollow Country Club'],
              ['Entertainment', 'MB Events'],
              ['Photographer', 'North Shore Photo'],
              ['Decor', 'Atelier Decor'],
              ['Cake', 'Harbor Cake Co.'],
            ].map(([role, name]) => (
              <li key={role} className="flex items-center justify-between border border-[var(--mb-line)] px-4 py-4">
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-muted)]">{role}</span>
                <span className="font-display text-2xl">{name}</span>
              </li>
            ))}
          </ul>
        )}

        <Link href="/e/jessica16" className="mt-10 inline-block text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-champagne)]">
          Open the invitation
        </Link>
      </div>
    </main>
  );
}

export function PlannerPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
