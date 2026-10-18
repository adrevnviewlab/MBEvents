export function OfficeNote({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <header className="pl-hero">
          <div className="pl-k">{kicker}</div>
          <h1>{title}</h1>
        </header>
        <div className="pl-card">{children}</div>
      </div>
    </div>
  );
}
