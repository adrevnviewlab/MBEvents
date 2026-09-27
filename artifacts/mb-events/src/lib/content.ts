export type EventTypeValue =
  | 'Wedding'
  | 'Sweet 16'
  | 'Quinceañera'
  | 'Bar / Bat Mitzvah'
  | 'Birthday Party'
  | 'Corporate Event'
  | 'School / Graduation Event'
  | 'Private Party'
  | 'Other';

export type LeadSource =
  | 'website_builder'
  | 'date_check'
  | 'venue_finder'
  | 'contact_form'
  | 'experience'
  | 'service';

export type ExperienceId = 'nightclub' | 'luxury' | 'takeover';

export const A = `${import.meta.env.BASE_URL}assets/`;
export const M = `${import.meta.env.BASE_URL}media/`;

export const brand = {
  name: 'Michael Bryan Events',
  short: 'MB Events',
  tagline: 'Your event starts here.',
  phone: '(855) 627-6863',
  phoneTel: '18556276863',
  email: 'mike@mbeventsny.com',
  address: '3034 Merrick Rd',
  city: 'Wantagh, NY 11793',
  hours: 'By appointment · Tri-State & beyond',
  about:
    'Michael Bryan Events, based out of Long Island, NY, is a professional, fully licensed and insured mobile DJ & entertainment company serving the Tri-State area — and destinations beyond.',
  goal: 'We believe your event is more than a one-day party. It’s a milestone. Our goal is to make sure the night goes off without a hitch — and that you and your guests leave completely captivated.',
};

export const eventTypes: {
  label: string;
  value: EventTypeValue;
  image: string;
  blurb: string;
  href: string;
}[] = [
  {
    label: 'Wedding',
    value: 'Wedding',
    image: `${M}weddings.jpg`,
    blurb: 'Ceremony to last dance — paced, polished, stress-free.',
    href: '/weddings',
  },
  {
    label: 'Sweet 16',
    value: 'Sweet 16',
    image: `${A}sweet-sixteen.jpg`,
    blurb: 'Club lighting, MCs, and a night that feels entirely theirs.',
    href: '/sweet-16',
  },
  {
    label: 'Quinceañera',
    value: 'Quinceañera',
    image: `${M}quince.jpg`,
    blurb: 'Bilingual DJs & MCs who know every tradition by heart.',
    href: '/quinceanera',
  },
  {
    label: 'Bar / Bat Mitzvah',
    value: 'Bar / Bat Mitzvah',
    image: `${M}mitzvah.jpg`,
    blurb: 'Taste, dignity, and a dance floor that never cools down.',
    href: '/mitzvah',
  },
  {
    label: 'Birthday Party',
    value: 'Birthday Party',
    image: `${M}sparkle-reception.jpg`,
    blurb: 'Milestone birthdays with energy, light, and great pacing.',
    href: '/birthday',
  },
  {
    label: 'Corporate Event',
    value: 'Corporate Event',
    image: `${M}corporate.jpg`,
    blurb: 'Holiday parties, casino nights, and teams that finally dance.',
    href: '/corporate',
  },
  {
    label: 'School / Graduation Event',
    value: 'School / Graduation Event',
    image: `${A}corporate-party.jpg`,
    blurb: 'Proms, graduations, and school nights that feel premium.',
    href: '/school',
  },
  {
    label: 'Private Party',
    value: 'Private Party',
    image: `${A}hero-ballroom.jpg`,
    blurb: 'Anniversaries, reunions, and any room with a reason.',
    href: '/private-party',
  },
  {
    label: 'Other',
    value: 'Other',
    image: `${M}uplighting-ballroom.jpg`,
    blurb: 'Something unique? Tell us — we’ll shape the night around it.',
    href: '/contact',
  },
];

export const experiences: {
  id: ExperienceId;
  title: string;
  tagline: string;
  image: string;
  detail: string;
  includes: string[];
}[] = [
  {
    id: 'nightclub',
    title: 'Nightclub Energy',
    tagline: 'Lasers, bass, and a floor that never cools down.',
    image: `${M}hero-laser-dance-poster.jpg`,
    detail:
      'High-impact lighting, DJ direction, and party motivators that turn a ballroom into a club — the same spark and laser energy clients rave about.',
    includes: ['Intelligent lighting & lasers', 'DJ + MC direction', 'Party motivators / dancers', 'Club-style sound'],
  },
  {
    id: 'luxury',
    title: 'Modern Luxury',
    tagline: 'Quiet confidence. Soft light. Every cue lands.',
    image: `${M}hero3-table.png`,
    detail:
      'Refined production for black-tie dinners, cocktail hours, and celebrations that whisper instead of shout — uplighting, soft cues, polished hosting.',
    includes: ['Warm uplighting', 'Ceremony & reception pacing', 'Refined MC hosting', 'Photo & video cues'],
  },
  {
    id: 'takeover',
    title: 'Full Takeover',
    tagline: 'We own the room from first look to last song.',
    image: `${M}hero2-dj.jpg`,
    detail:
      'DJ, MC, lighting, AV, photo experiences, and coordination — one team shaping the entire night so you can actually enjoy it.',
    includes: ['DJ + MC', 'Lighting & production', 'Photo booth / experiences', 'Day-of coordination'],
  },
];

export const serviceCategories: {
  id: string;
  title: string;
  tagline: string;
  image: string;
  items: string[];
  detail: string;
}[] = [
  {
    id: 'entertainment',
    title: 'Entertainment',
    tagline: 'DJs, MCs, and sound that read the room.',
    image: `${M}service-entertainment.jpg`,
    items: ['DJ', 'MC', 'Sound systems', 'Live entertainment', 'Live percussion'],
    detail:
      'Professional disc jockeys who are also masters of ceremonies — reading crowds, pacing the night, and playing the music you actually want to hear.',
  },
  {
    id: 'photography-video',
    title: 'Photography & Video',
    tagline: 'The moments you’ll want to keep.',
    image: `${M}service-photo.jpg`,
    items: ['Photography', 'Videography', 'Photo montages', 'Slideshows'],
    detail:
      'From wedding video services to digital photo and video montages on plasma screens — we help capture and present the story of the night.',
  },
  {
    id: 'lighting-production',
    title: 'Lighting & Production',
    tagline: 'Uplighting, movers, lasers, dance-floor magic.',
    image: `${M}service-lighting.jpg`,
    items: ['Lighting', 'Moving lights', 'Uplighting', 'Lasers', 'Dance floor effects', 'Entrances'],
    detail:
      'Intelligent lighting, uplighting, sparkler entrances, dancing on the clouds, and full dance-floor production that transforms the room.',
  },
  {
    id: 'photo-experiences',
    title: 'Photo Experiences',
    tagline: 'Booths and moments guests talk about.',
    image: `${M}service-photo-exp.jpg`,
    items: ['Photo booth', '3D rooms', 'Interactive photo moments'],
    detail:
      'Photo booth experiences and immersive setups that keep guests engaged — and send them home with keepsakes.',
  },
  {
    id: 'event-planning',
    title: 'Event Planning',
    tagline: 'Coordination that keeps the night stress-free.',
    image: `${M}service-planning.jpg`,
    items: ['Coordination', 'Planning', 'Wedding coordinators', 'Day-of flow'],
    detail:
      'Wedding and event coordination so announcements, cues, and timing stay seamless — whether we lead planning or partner with your planner.',
  },
  {
    id: 'specialty',
    title: 'Specialty Entertainment',
    tagline: 'Karaoke, casino nights, dancers, game shows.',
    image: `${M}service-specialty.jpg`,
    items: ['Dancers & party motivators', 'Karaoke', 'Casino nights', 'Game shows', 'Theme parties', 'Gaming systems'],
    detail:
      'From casino tables and karaoke to interactive game shows and dance crews — extras that make corporate and private events unforgettable.',
  },
];

export const vibes = [
  { id: 'high-energy', label: 'High energy', blurb: 'Packed dance floor, big drops, nonstop motion.' },
  { id: 'elegant', label: 'Elegant & refined', blurb: 'Soft cues, polished hosting, elevated pacing.' },
  { id: 'intimate', label: 'Intimate & warm', blurb: 'Close rooms, personal toasts, softer volume.' },
  { id: 'surprise', label: 'Surprise moments', blurb: 'Entrances, reveals, and a few unforgettable cues.' },
];

/** Premium service groups used in Build My Event “what matters” step */
export const servicePriorities = serviceCategories.map((c) => ({
  id: c.id,
  label: c.title,
  blurb: c.tagline,
  items: c.items,
}));

export const galleryItems = [
  {
    type: 'video' as const,
    src: `${M}sparkler-entrance.mp4`,
    poster: `${M}sparkler-entrance-poster.jpg`,
    label: 'Sparkler entrance',
    caption: 'The night walks in glowing.',
  },
  {
    type: 'video' as const,
    src: `${M}wedding-rob-krista.mp4`,
    poster: `${M}wedding-rob-krista-poster.jpg`,
    label: 'Wedding recap',
    caption: 'Rob & Krista — soft light, big feeling.',
  },
  {
    type: 'video' as const,
    src: `${M}dancing-on-clouds.mp4`,
    poster: `${M}dancing-on-clouds-poster.jpg`,
    label: 'Dancing on clouds',
    caption: 'First dance, floating.',
  },
  {
    type: 'video' as const,
    src: `${M}laser-dance.mp4`,
    poster: `${M}laser-dance-poster.jpg`,
    label: 'Laser dance floor',
    caption: 'Ballroom becomes nightclub.',
  },
  {
    type: 'video' as const,
    src: `${M}wedding-dan-cindy.mp4`,
    poster: `${M}wedding-dan-cindy-poster.jpg`,
    label: 'Wedding night',
    caption: 'Dan & Cindy — every cue landed.',
  },
  {
    type: 'video' as const,
    src: `${M}mb-sound-dance-floor.mp4`,
    poster: `${M}uplighting-ballroom.jpg`,
    label: 'Dance floor',
    caption: 'Production that fills the room.',
  },
  {
    type: 'image' as const,
    src: `${M}uplighting-ballroom.jpg`,
    label: 'Ballroom glow',
    caption: 'Uplighting that sets the mood.',
  },
  {
    type: 'image' as const,
    src: `${A}father-daughter-dance.jpg`,
    label: 'Father & daughter',
    caption: 'The quiet ones matter most.',
  },
  {
    type: 'image' as const,
    src: `${M}sparkle-reception.jpg`,
    label: 'Reception sparkle',
    caption: 'Warm light, sharp timing.',
  },
];

export const reviews = [
  {
    quote:
      'Best part of our wedding — absolutely blown away by the DJ, MC, and photobooth. Easy to work with, punctual, fair with prices. Guests told us over 10 times the DJ was the best they’d heard at any event.',
    name: 'Nick & Cindy K.',
    place: 'Wedding · Nov 2025',
    image: `${M}weddings.jpg`,
  },
  {
    quote:
      'The BEST DJ EVER!! Perfect blend of songs, dancing all night. Mike catered to our needs — and the planning portal for songs and timeline made everything easy.',
    name: 'Abigail G.',
    place: 'Wedding · Jul 2025',
    image: `${A}sweet-sixteen.jpg`,
  },
  {
    quote:
      'Everything was perfect. The sound quality, photo booth, dancing on a cloud, and beautiful equipment setup were all amazing. You will not be disappointed.',
    name: 'DeNae H.',
    place: 'Wedding · Apr 2025',
    image: `${M}laser-dance-poster.jpg`,
  },
  {
    quote:
      'We would like to thank MB Sound Productions & Entertainment for helping our son’s Bar Mitzvah go off without a hitch. On such an important day, everything should be perfect — and MB surely helped see to that.',
    name: 'Jennifer L.',
    place: 'Syosset, NY',
    image: `${M}mitzvah.jpg`,
  },
  {
    quote:
      'MB really came through for my daughter’s Quinceañera. Your Spanish MC Fernando was great, and the DJ played music both young and older enjoyed. Everyone was dancing.',
    name: 'Brian & Rachel M.',
    place: 'Muttontown, NY',
    image: `${M}quince.jpg`,
  },
];

export const venues = [
  { name: 'The Inn at New Hyde Park', area: 'New Hyde Park', capacity: '150–400', image: `${A}hero-ballroom.jpg`, vibe: 'Grand ballroom · Classic LI favorite' },
  { name: 'Crest Hollow Country Club', area: 'Woodbury', capacity: '200–500', image: `${M}hero1.jpg`, vibe: 'Country club elegance · Big nights' },
  { name: 'The Sands Regency', area: 'Atlantic Beach', capacity: '100–350', image: `${M}hero3-table.png`, vibe: 'Waterfront polish · Soft light' },
  { name: 'Harbor Club at Prime', area: 'Huntington', capacity: '80–250', image: `${A}corporate-party.jpg`, vibe: 'Harbor views · Intimate luxury' },
  { name: 'Rocco Anthony’s', area: 'East Rockaway', capacity: '80–220', image: `${M}uplighting-ballroom.jpg`, vibe: 'Affiliate venue · Warm receptions' },
  { name: 'Wantagh & LI favorites', area: 'Long Island', capacity: 'Flexible', image: `${M}weddings.jpg`, vibe: 'We’ll match rooms we know by heart' },
];

export const faqs = [
  {
    q: 'What occasions do you accommodate?',
    a: 'Weddings, Sweet 16s, Quinceañeras, bar/bat mitzvahs, corporate events, school functions, holiday parties, anniversaries, and more — we’re built for versatility.',
  },
  {
    q: 'How early should I book?',
    a: 'As early as possible. Popular dates can book a year out. We suggest meeting at least 4–6 months prior when you can.',
  },
  {
    q: 'How far will you travel?',
    a: 'Primarily the Tri-State area (Long Island, NYC, Westchester, and beyond), but our team is flight-ready for destinations farther out. Travel fees apply outside our normal coverage.',
  },
  {
    q: 'Are you insured?',
    a: 'Yes — we carry liability insurance, and many venues require proof.',
  },
];

export const weddingCopy = {
  title: 'Weddings',
  eyebrow: 'Once-in-a-lifetime production',
  lead: 'From the ceremony prelude to the newlyweds’ departure, we provide entertainment, ambiance, and coordination so your day feels stress-free — and unforgettable.',
  body: 'Whether you need a wedding DJ, full lighting design, photography & video, a photo booth, karaoke, or day-of coordination, we build a package around your vision. We meet with each couple in advance so the day flows exactly the way you imagined.',
  bullets: [
    'Wedding DJ & MC hosting',
    'Ceremony & reception music',
    'Lighting, uplighting & entrances',
    'Photo booth & video services',
    'Wedding coordination support',
  ],
};

export const quinceCopy = {
  title: 'Quinceañeras',
  eyebrow: 'A tradition, fully produced',
  lead: 'Bilingual DJs and MCs who know the court, the waltz, and the moment the floor should open up.',
  body: 'From the surprise dance to the last song, we pace the night so family and friends both stay on the floor — with lighting, photo moments, and hosting that respects every tradition.',
  bullets: ['Bilingual DJ & MC', 'Court & waltz cues', 'Lighting & entrances', 'Photo experiences', 'Family and dance-floor sets'],
};

export const mitzvahCopy = {
  title: 'Bar & Bat Mitzvahs',
  eyebrow: 'Dignity, then the dance floor',
  lead: 'A celebration that feels personal during the ceremony moments and electric once the party starts.',
  body: 'We work with your planner and venue on timing, candle lighting, and the set that gets cousins, parents, and friends dancing — without losing the tone of the day.',
  bullets: ['MC who reads the room', 'Candle lighting & hora', 'Age-right music direction', 'Lighting & photo booth', 'Parent and teen sets'],
};

export const corporateCopy = {
  title: 'Corporate events',
  eyebrow: 'Teams that actually dance',
  lead: 'Holiday parties, awards nights, and client events with sound, light, and entertainment that stays professional.',
  body: 'Casino nights, game shows, karaoke, and a DJ who can move a room from dinner to dancing without awkward gaps. We handle the production so your team can host.',
  bullets: ['Holiday parties & awards', 'Casino & game-show nights', 'Clean sound for speeches', 'Lighting that fits the brand', 'Day-of coordination'],
};

export const birthdayCopy = {
  title: 'Birthday parties',
  eyebrow: 'Milestone nights',
  lead: 'From a 30th to a 50th, the room should feel like it was built for that person.',
  body: 'We pace dinner, speeches, and the dance floor so the celebration feels personal — with lighting, a host, and a set that fits the crowd in the room.',
  bullets: ['DJ & MC', 'Lighting for the room', 'Entrances & toasts', 'Photo moments', 'A set for every generation'],
};

export const schoolCopy = {
  title: 'School & graduation',
  eyebrow: 'Nights they remember',
  lead: 'Proms, graduations, and school events with energy that still feels appropriate.',
  body: 'Clean sound for speeches, a dance floor that fills, and production that works with the school’s rules — not against them.',
  bullets: ['Prom & graduation nights', 'Speech-ready sound', 'Age-right music', 'Lighting', 'Staff who know school venues'],
};

export const privateCopy = {
  title: 'Private parties',
  eyebrow: 'Any reason to gather',
  lead: 'Anniversaries, reunions, and house-to-ballroom nights with the same care as a wedding.',
  body: 'Tell us the room and the people. We’ll bring sound, light, and a host so you can stay in the party instead of running it.',
  bullets: ['Anniversaries & reunions', 'Flexible room sizes', 'DJ, MC & lighting', 'Photo experiences', 'Day-of flow'],
};

export const partners = [
  { name: 'North Shore Photo', category: 'Photography', area: 'Long Island', blurb: 'Ceremony through last dance, delivered fast.', verified: true },
  { name: 'Lumen Floral', category: 'Florists', area: 'Nassau', blurb: 'Rooms that match the lighting, not fight it.', verified: true },
  { name: 'Harbor Cake Co.', category: 'Cake', area: 'Suffolk', blurb: 'The cake moment, timed with the song.', verified: true },
  { name: 'Atelier Decor', category: 'Decor', area: 'Tri-State', blurb: 'Tables and ceilings that take uplighting well.', verified: true },
  { name: 'Kinetic Film', category: 'Videography', area: 'NYC & LI', blurb: 'Highlight films cut to the night MB built.', verified: true },
  { name: 'Island Cars', category: 'Transportation', area: 'Long Island', blurb: 'Guest shuttles that actually arrive on time.', verified: false },
];

export const sweet16Checklist = [
  { id: 'venue', label: 'Select venue', done: true },
  { id: 'book', label: 'Book MB', done: true },
  { id: 'invite', label: 'Create invitation', done: false },
  { id: 'photo', label: 'Choose photographer', done: false },
  { id: 'light', label: 'Choose lighting', done: false },
  { id: 'entrance', label: 'Select entrance', done: false },
  { id: 'court', label: 'Choose court', done: false },
  { id: 'cake', label: 'Select cake', done: false },
  { id: 'music', label: 'Music preferences', done: false },
  { id: 'count', label: 'Final guest count', done: false },
  { id: 'timeline', label: 'Final timeline', done: false },
  { id: 'vendors', label: 'Confirm vendors', done: false },
];

export const sweet16Copy = {
  title: 'Sweet 16s',
  eyebrow: 'Once in a lifetime',
  lead: 'Sweet 16 only comes around once — so it should feel like the best night of their life. We bring club-style production without the stress.',
  body: 'Professional DJs mixing today’s hottest tracks, state-of-the-art sound, intelligent lighting, MCs who pump the energy, photo & video montages on plasma screens, and personalized candle-lighting moments.',
  bullets: [
    'Professional DJs & energetic MCs',
    'Club-style intelligent lighting',
    'Photo & video montages',
    'Party favors & keepsakes',
    'Personalized candle lighting',
  ],
};
