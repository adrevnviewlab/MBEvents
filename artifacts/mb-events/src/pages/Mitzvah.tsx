import { M, mitzvahCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function MitzvahPage() {
  return <OccasionPage copy={mitzvahCopy} eventType="Bar / Bat Mitzvah" image={`${M}mitzvah.jpg`} testId="mitzvah" />;
}
