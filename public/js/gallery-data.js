/**
 * ============================================================================
 * EPIC CLUB - ACTIVITIES GALLERY DATA & CONFIGURATION
 * Faculty of Medicine of Sétif, Algeria
 * ============================================================================
 *
 * HOW TO ADD OR REPLACE PHOTOGRAPHS:
 * ----------------------------------------------------------------------------
 * 1. Place your photo file (JPG, PNG, or WebP) in the root or /public directory.
 * 2. Locate the corresponding item below or add a new entry to EPIC_GALLERY_ITEMS.
 * 3. Update the `src` property to match your file name (e.g., 'sutures-2026.jpg').
 * 4. Set `isVerifiedPhoto: true`.
 * 5. Update `title`, `category`, and `caption` with the verified event details.
 * ----------------------------------------------------------------------------
 */

const EPIC_GALLERY_CATEGORIES = [
  { id: 'all', label: 'All Photographs' },
  { id: 'community', label: 'Student Community' },
  { id: 'clinical-workshops', label: 'Scientific Workshops' },
  { id: 'public-health', label: 'Public Health Campaigns' },
  { id: 'conferences', label: 'Conferences & Congresses' },
  { id: 'student-events', label: 'Student Events' }
];

const EPIC_GALLERY_ITEMS = [
  {
    id: 'epic-hidhab-pharma-expo',
    title: 'Hidhab Pharma Expo 4 - EPIC Stand & Outreach',
    category: 'public-health',
    categoryLabel: 'Public Health Campaigns',
    src: 'photo/IMG_20261024_231656_994.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-featured', // 7 cols, 2 rows
    caption: 'EPIC Club booth welcoming pharmacy students, researchers, and healthcare professionals at the 4th Hidhab Pharma Expo in Sétif.',
    location: 'Parc des Expositions, Sétif',
    badgeText: 'Verified EPIC Photograph'
  },
  {
    id: 'epic-clinical-simulation-mesbah',
    title: 'Clinical Simulation & Skills Workshop with Pr. Mesbah Nabil',
    category: 'clinical-workshops',
    categoryLabel: 'Scientific Workshops',
    src: 'photo/IMG_20261024_231706_441.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-tall', // 5 cols, 2 rows (portrait orientation)
    caption: 'Hands-on clinical skills training on adult and pediatric simulation mannequins under the mentorship of Pr. Mesbah Nabil (CHU Sétif).',
    location: 'Laboratoire de Simulation Clinique, CHU Sétif',
    badgeText: 'Verified EPIC Photograph'
  },
  {
    id: 'epic-digital-dentistry-conference',
    title: 'Digital Dentistry Seminar with Dr. Bouali Charaf Eddine',
    category: 'conferences',
    categoryLabel: 'Conferences & Congresses',
    src: 'photo/IMG_20261024_231659_503.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-wide', // 8 cols, 1 row
    caption: 'Interactive scientific symposium exploring digital technologies in modern dentistry and clinical practice with Dr. Bouali Charaf Eddine.',
    location: 'Auditorium Central, UFAS 1',
    badgeText: 'Verified EPIC Photograph'
  },
  {
    id: 'epic-winter-babor-summit',
    title: 'Winter Expedition to Mount Babor Peak (2004m)',
    category: 'student-events',
    categoryLabel: 'Student Events',
    src: 'photo/IMG_20261024_231703_293.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-standard', // 4 cols, 1 row
    caption: 'EPIC members reaching the snowy summit of Pic de Babor (2004m) during the annual student winter outdoor expedition.',
    location: 'Parc National de Babor-Tababort, Sétif',
    badgeText: 'Verified EPIC Photograph'
  },
  {
    id: 'epic-babor-forest-retreat',
    title: 'Nature Excursion & Member Team Building',
    category: 'community',
    categoryLabel: 'Student Community',
    src: 'photo/IMG_20261024_231704_561.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-standard', // 4 cols, 1 row
    caption: 'Connecting beyond hospital wards and amphitheatres—medical students gathering during the annual outdoor team retreat.',
    location: 'Babor Mountain Forest Reserve',
    badgeText: 'Verified EPIC Photograph'
  },
  {
    id: 'epic-annual-symposium-closing',
    title: 'Annual Academic Symposium Closing & Recognition',
    category: 'community',
    categoryLabel: 'Student Community',
    src: 'photo/IMG_20261024_231701_412.jpg',
    isVerifiedPhoto: true,
    gridClass: 'gallery-item-wide', // 8 cols, 1 row
    caption: 'EPIC Club organizing committee celebrating student achievements on stage and presenting certificates at the academic year closing.',
    location: 'Faculty of Medicine Amphitheater, Sétif',
    badgeText: 'Verified EPIC Photograph'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EPIC_GALLERY_CATEGORIES, EPIC_GALLERY_ITEMS };
}
