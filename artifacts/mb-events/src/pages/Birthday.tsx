import { M, birthdayCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function BirthdayPage() {
  return <OccasionPage copy={birthdayCopy} eventType="Birthday Party" image={`${M}sparkle-reception.jpg`} testId="birthday" />;
}
