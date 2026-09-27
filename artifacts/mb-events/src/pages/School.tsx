import { A, schoolCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function SchoolPage() {
  return <OccasionPage copy={schoolCopy} eventType="School / Graduation Event" image={`${A}corporate-party.jpg`} testId="school" />;
}
