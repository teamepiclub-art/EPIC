/**
 * EPIC CLUB - Interactive Homepage Application
 * Faculty of Medicine of Sétif, Algeria
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initStatsCounters();
  initActivitiesFilter();
  initActivityModals();
  initDepartmentModals();
  initSmoothScroll();
});

/* ==========================================================================
   Navigation & Mobile Menu
   ========================================================================== */
function initNavigation() {
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.mobile-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const navLinks = document.querySelectorAll('.nav-link');

  // Scroll effect on header
  window.addEventListener('scroll', () => {
    if (window.scrollY > 30) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });

  // Mobile menu toggle
  if (toggle && navMenu) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.toggle('is-active');
      navMenu.classList.toggle('is-active');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('is-active');
        navMenu.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target) && navMenu.classList.contains('is-active')) {
        toggle.classList.remove('is-active');
        navMenu.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/* ==========================================================================
   Smooth Scrolling for Anchors
   ========================================================================== */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || targetId === '') return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 90;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

/* ==========================================================================
   Stats Counter Animation
   ========================================================================== */
function initStatsCounters() {
  const statNumbers = document.querySelectorAll('.stat-number');
  if (!statNumbers.length) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const targetVal = parseInt(el.getAttribute('data-target'), 10);
        if (!isNaN(targetVal)) {
          animateValue(el, 0, targetVal, 2000);
        }
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.3 });

  statNumbers.forEach(num => observer.observe(num));
}

function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    // Ease-out cubic
    const easeOut = 1 - Math.pow(1 - progress, 3);
    obj.innerHTML = Math.floor(easeOut * (end - start) + start).toLocaleString();
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.innerHTML = end.toLocaleString();
    }
  };
  window.requestAnimationFrame(step);
}

/* ==========================================================================
   Activities Gallery Filters
   ========================================================================== */
function initActivitiesFilter() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const activityCards = document.querySelectorAll('.activity-card');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');

      activityCards.forEach(card => {
        const cardTrack = card.getAttribute('data-track');
        if (filter === 'all' || cardTrack === filter) {
          card.style.display = 'flex';
          setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          }, 20);
        } else {
          card.style.opacity = '0';
          card.style.transform = 'translateY(10px)';
          setTimeout(() => {
            card.style.display = 'none';
          }, 200);
        }
      });
    });
  });
}

/* ==========================================================================
   Activity Modals
   ========================================================================== */
const activitiesData = {
  suturing: {
    title: 'Clinical Sutures & Basic Surgical Skills Bootcamp',
    track: 'Clinical Workshops',
    date: 'February 14, 2026',
    venue: 'Laboratoire d\'Anatomie Humaine - Faculté de Médecine de Sétif',
    attendees: '120 Medical Students (Externes & Internes)',
    mentors: 'Dr. K. Belkacemi (Chirurgie Générale, CHU Sétif), Internes en Chirurgie',
    desc: 'An intensive, hands-on clinical simulation designed to master surgical asepsis, instrument handling, knot tying, and advanced wound closure techniques (simple interrupted, vertical and horizontal mattress, continuous running, and subcuticular sutures).',
    highlights: [
      'Individual surgical toolkits provided for each participant',
      'Realistic synthetic tissue pads and pig skin biological models',
      'One-on-one mentorship ratio: 1 surgeon per 6 students',
      'Clinical emergency management of traumatic lacerations'
    ]
  },
  octobre_rose: {
    title: 'Octobre Rose: Breast Cancer Awareness & Early Screening Caravan',
    track: 'Public Health',
    date: 'October 18–24, 2025',
    venue: 'Park Mall Sétif & Centre Hospitalo-Universitaire Saadna Abdenour',
    attendees: '1,450+ Citizens Screened & Informed',
    mentors: 'Pr. M. Hamdi (Oncologie Médicale), Dr. A. Mansouri (Gynécologie-Obstétrique)',
    desc: 'A massive public health mobilization in Sétif wilaya focused on early detection, clinical breast examination training, mammography orientation, and breaking sociocultural taboos surrounding women\'s health.',
    highlights: [
      'Interactive palpation workshops using medical simulation mannequins',
      'Direct mammography vouchers secured in partnership with CHU Sétif',
      'Distribution of over 2,500 patient education guides in French & Arabic',
      'Multidisciplinary panel discussion featuring oncologists and survivors'
    ]
  },
  cardiology: {
    title: 'Cardiology Masterclass: Practical ECG Interpretation & Arrhythmias',
    track: 'Clinical Workshops',
    date: 'December 06, 2025',
    venue: 'Amphithéâtre Ibn Sina - Faculté de Médecine de Sétif',
    attendees: '280 Medical Students & Residents',
    mentors: 'Pr. N. Bouzid (Service de Cardiologie, CHU Sétif)',
    desc: 'An interactive clinical simulation decoding 12-lead electrocardiograms from emergency room arrivals to coronary unit admissions. Students tackled real tracing scenarios of STEMI, ventricular tachycardias, heart blocks, and electrolyte disorders.',
    highlights: [
      'Live interactive polling with 35 real clinical ECG case studies',
      'Systematic 6-step interpretation algorithm developed for exams & residency',
      'Emergency pharmacology protocol review for acute cardiac arrests',
      'Certificate of clinical simulation mastery issued to attendees'
    ]
  },
  congress: {
    title: 'Annual Medical Research & Scientific Poster Symposium',
    track: 'Scientific Research',
    date: 'May 10, 2025',
    venue: 'Auditorium Central - Université Ferhat Abbas Sétif 1',
    attendees: '350 Participants & Faculty Professors',
    mentors: 'Pr. F. Rahmani (Vice-Doyen de la Faculté de Médecine), Pr. S. Zerrouk',
    desc: 'The benchmark academic event showcasing student research projects, epidemiological surveys, and systematic literature reviews conducted across university hospital departments.',
    highlights: [
      '42 oral abstracts and scientific posters presented by undergraduate researchers',
      'Biostatistics and meta-analysis workshops led by epidemiological researchers',
      'Peer-reviewed book of abstracts published in collaboration with UFAS 1',
      'Annual Innovation Prize awarded to the top clinical study'
    ]
  },
  diabetes: {
    title: 'World Diabetes & Hypertension Screening Caravan',
    track: 'Public Health',
    date: 'November 14, 2025',
    venue: 'Place Aïn El Fouara & Place des Martyrs, Sétif',
    attendees: '920 Citizens Screened',
    mentors: 'Service de Médecine Interne & Endocrinologie, CHU Sétif',
    desc: 'A flagship community health campaign providing free blood glucose testing, blood pressure screening, cardiovascular risk scoring, and tailored dietary consultations to the public in Sétif.',
    highlights: [
      'Immediate referral system for newly diagnosed severe cases to local polyclinics',
      'Nutritional coaching booth guided by 5th year medical students',
      'Specialized foot inspection for elderly diabetic patients',
      'Partnership with regional red crescent and primary care providers'
    ]
  },
  bls: {
    title: 'Basic Life Support & Emergency Trauma Response (BLS/CPR)',
    track: 'Clinical Workshops',
    date: 'January 20, 2026',
    venue: 'Salle des Travaux Pratiques - Faculté de Médecine',
    attendees: '150 1st & 2nd Year Medical Students',
    mentors: 'SAMU 19 Sétif & Urgences Médico-Chirurgicales',
    desc: 'Foundational resuscitation training for junior medical and pharmacy students. Covered cardiopulmonary resuscitation (CPR), automated external defibrillator (AED) usage, foreign body airway obstruction, and cervical spine stabilization.',
    highlights: [
      'High-fidelity feedback QCPR manikins measuring compression depth and rate',
      'Mock cardiac arrest team leader simulations in noisy conditions',
      'Safe recovery position and pediatric choking algorithms',
      'Every participant certified in Basic Life Support competencies'
    ]
  }
};

function initActivityModals() {
  const backdrop = document.getElementById('activityModalBackdrop');
  if (!backdrop) return;

  const modalTitle = document.getElementById('modalActivityTitle');
  const modalTrack = document.getElementById('modalActivityTrack');
  const modalDate = document.getElementById('modalActivityDate');
  const modalVenue = document.getElementById('modalActivityVenue');
  const modalAttendees = document.getElementById('modalActivityAttendees');
  const modalMentors = document.getElementById('modalActivityMentors');
  const modalDesc = document.getElementById('modalActivityDesc');
  const modalHighlights = document.getElementById('modalActivityHighlights');
  const closeBtn = document.getElementById('modalCloseBtn');

  document.querySelectorAll('[data-activity-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-activity-id');
      const item = activitiesData[id];
      if (!item) return;

      modalTitle.textContent = item.title;
      modalTrack.textContent = item.track;
      modalDate.textContent = item.date;
      modalVenue.textContent = item.venue;
      modalAttendees.textContent = item.attendees;
      modalMentors.textContent = item.mentors;
      modalDesc.textContent = item.desc;

      modalHighlights.innerHTML = '';
      item.highlights.forEach(h => {
        const li = document.createElement('li');
        li.textContent = h;
        modalHighlights.appendChild(li);
      });

      backdrop.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeModal = () => {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) {
      closeModal();
    }
  });
}

/* ==========================================================================
   Department Modals
   ========================================================================== */
const departmentsData = {
  media: {
    name: 'Media Department',
    lead: 'Visual & Digital Communications',
    mission: 'Turning ideas into impactful visuals through graphic design, photography, videography, and digital communication.',
    responsibilities: [
      'Editorial graphic design and brand identity across all media channels',
      'Event photography and cinematic aftermovies capturing club activities',
      'Digital communication, scientific infographics, and social media storytelling',
      'Managing the official club web portal and announcements'
    ],
    skills: 'Graphic design, digital media, videography, creative communication'
  },
  workshop: {
    name: 'Workshop and Decoration Department',
    lead: 'Creative Events & Workshop Production',
    mission: 'Creating engaging workshops and transforming ideas into memorable event experiences.',
    responsibilities: [
      'Designing experiential stage decor and ambiance for all club symposiums',
      'Coordinating interactive workshop materials and hands-on session kits',
      'Transforming conceptual themes into immersive visual environments',
      'Setting up amphitheater decor, welcoming booths, and ceremonial stages'
    ],
    skills: 'Event curation, artistic decoration, workshop planning, teamwork'
  },
  public_health: {
    name: 'Public Health Department',
    lead: 'Community Awareness & Prevention Taskforce',
    mission: 'Raising health awareness and promoting prevention through educational campaigns and community initiatives.',
    responsibilities: [
      'Organizing regional screening caravans across Sétif and local municipalities',
      'Promoting disease prevention (diabetes, hypertension, cancer awareness)',
      'Delivering patient education and evidence-based public health guidance',
      'Collaborating with primary health centers and community organizations'
    ],
    skills: 'Epidemiological awareness, patient communication, community organizing, health advocacy'
  },
  language: {
    name: 'Language and Cultural Department',
    lead: 'Cultural Exchange & Communication Desk',
    mission: 'Bringing people together through languages, cultural exchange, and creative communication activities.',
    responsibilities: [
      'Facilitating medical terminology and language conversation circles',
      'Organizing multicultural exchange days and cultural discussion panels',
      'Creating interactive debate clubs and public speaking training',
      'Connecting medical students from diverse cultural and linguistic backgrounds'
    ],
    skills: 'Intercultural communication, language fluency, public speaking, empathy'
  },
  sports: {
    name: 'Sports and Entertainment Department',
    lead: 'Recreation & Student Wellness Board',
    mission: 'Building team spirit and creating unforgettable moments through sports, games, and entertainment.',
    responsibilities: [
      'Organizing inter-year football, basketball, and athletics tournaments',
      'Hosting quiz bowls, trivia nights, and medical student challenge days',
      'Promoting physical wellness, mental health balance, and team cohesion',
      'Creating vibrant entertainment events and celebration evenings'
    ],
    skills: 'Sports coordination, team building, group dynamics, event leadership'
  },
  outings: {
    name: 'Outings and Excursions Department',
    lead: 'Expedition & Trips Directorate',
    mission: 'Discovering new places, sharing adventures, and strengthening bonds through trips and group outings.',
    responsibilities: [
      'Planning safe and exciting hiking trips, cultural tours, and national excursions',
      'Coordinating transportation, group logistics, itineraries, and lodging',
      'Strengthening friendship and camaraderie outside hospital and lecture walls',
      'Capturing travel memories and exploring natural landscapes across Algeria'
    ],
    skills: 'Travel planning, logistics, risk management, group leadership'
  },
  training: {
    name: 'Training and Development Department',
    lead: 'Academic Growth & Professional Skills Board',
    mission: 'Empowering members with practical skills, knowledge, and opportunities for continuous growth.',
    responsibilities: [
      'Leading soft skills training (leadership, time management, negotiation)',
      'Organizing peer-to-peer mentoring and academic study masterclasses',
      'Facilitating career orientation and residency preparation workshops',
      'Tracking personal growth and issuing verified participation certificates'
    ],
    skills: 'Curriculum development, mentorship, leadership coaching, academic pedagogy'
  }
};

function initDepartmentModals() {
  const backdrop = document.getElementById('deptModalBackdrop');
  if (!backdrop) return;

  const modalTitle = document.getElementById('modalDeptTitle');
  const modalLead = document.getElementById('modalDeptLead');
  const modalMission = document.getElementById('modalDeptMission');
  const modalList = document.getElementById('modalDeptList');
  const modalSkills = document.getElementById('modalDeptSkills');
  const closeBtn = document.getElementById('modalDeptCloseBtn');

  document.querySelectorAll('[data-dept-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Allow direct navigation when clicking on the "Join Department" link
      if (e.target.closest('.dept-apply-link')) {
        return;
      }
      e.preventDefault();
      const id = btn.getAttribute('data-dept-id');
      const item = departmentsData[id];
      if (!item) return;

      modalTitle.textContent = item.name;
      modalLead.textContent = item.lead;
      modalMission.textContent = item.mission;
      modalSkills.textContent = item.skills;

      // Update the modal apply link dynamically
      const modalApplyBtn = backdrop.querySelector('a[href^="/register"]');
      if (modalApplyBtn) {
        modalApplyBtn.href = `/register?dept=${id}`;
      }

      modalList.innerHTML = '';
      item.responsibilities.forEach(r => {
        const li = document.createElement('li');
        li.textContent = r;
        modalList.appendChild(li);
      });

      backdrop.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeModal = () => {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) {
      closeModal();
    }
  });
}
