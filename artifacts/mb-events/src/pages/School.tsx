import { M, schoolCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function SchoolPage() {
  return <OccasionPage copy={schoolCopy} eventType="School / Graduation Event" image={`${M}school.jpg`} testId="school" />;
}
