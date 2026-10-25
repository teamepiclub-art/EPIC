/**
 * ============================================================================
 * EPIC CLUB - ACTIVITIES GALLERY "A YEAR OF IMPACT" CONTROLLER
 * Dynamic grid rendering, category filtering, and lightbox interaction.
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  initEditorialGallery();
});

let currentLightboxIndex = 0;
let visibleGalleryItems = [];

function initEditorialGallery() {
  const gridContainer = document.getElementById('asymmetricGalleryGrid');
  const categoryNav = document.getElementById('galleryCategoryNav');
  if (!gridContainer || typeof EPIC_GALLERY_ITEMS === 'undefined') return;

  // Render category buttons
  renderCategoryButtons(categoryNav);

  // Initial render of all items
  filterGallery('all');

  // Initialize Lightbox controls
  initLightbox();
}

function renderCategoryButtons(container) {
  if (!container || typeof EPIC_GALLERY_CATEGORIES === 'undefined') return;
  container.innerHTML = '';

  EPIC_GALLERY_CATEGORIES.forEach((cat, idx) => {
    const btn = document.createElement('button');
    btn.className = `gallery-cat-btn ${idx === 0 ? 'is-active' : ''}`;
    btn.textContent = cat.label;
    btn.setAttribute('data-category', cat.id);

    btn.addEventListener('click', () => {
      document.querySelectorAll('.gallery-cat-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      filterGallery(cat.id);
    });

    container.appendChild(btn);
  });
}

function filterGallery(categoryId) {
  const gridContainer = document.getElementById('asymmetricGalleryGrid');
  if (!gridContainer) return;

  if (categoryId === 'all') {
    visibleGalleryItems = [...EPIC_GALLERY_ITEMS];
  } else {
    visibleGalleryItems = EPIC_GALLERY_ITEMS.filter(item => item.category === categoryId);
  }

  gridContainer.innerHTML = '';

  visibleGalleryItems.forEach((item, index) => {
    const tile = document.createElement('article');
    tile.className = `gallery-tile ${item.gridClass || 'gallery-item-standard'}`;
    tile.setAttribute('data-index', index);
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-label', `View ${item.title}`);

    if (item.isVerifiedPhoto && item.src) {
      // Verified photo tile
      tile.innerHTML = `
        <div class="tile-image-container">
          <img src="${item.src}" alt="${item.title}" class="tile-photo" loading="lazy">
          <div class="tile-overlay">
            <div class="tile-top-bar">
              <span class="tile-category-pill">${item.categoryLabel}</span>
              <span class="tile-verification-badge verified">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                ${item.badgeText}
              </span>
            </div>
            <div class="tile-bottom-content">
              <h3 class="tile-title">${item.title}</h3>
              <p class="tile-caption">${item.caption}</p>
              <div class="tile-meta-row">
                <span>📍 ${item.location}</span>
                <span class="tile-zoom-hint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                  Click to Expand
                </span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      // Sleek editorial placeholder tile
      tile.innerHTML = `
        <div class="tile-placeholder-canvas">
          <div class="tile-placeholder-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </div>
          <span class="tile-placeholder-tag">Pending Upload</span>
          <span class="tile-category-pill" style="margin-bottom: 8px; font-size: 10px; color: var(--navy); background: rgba(23,43,77,0.08); border-color: rgba(23,43,77,0.15);">${item.categoryLabel}</span>
          <h3 class="tile-placeholder-title">${item.title}</h3>
          <p class="tile-placeholder-desc">${item.caption}</p>
          <span class="tile-upload-hint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Click for Upload Guide
          </span>
        </div>
      `;
    }

    tile.addEventListener('click', () => openLightbox(index));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(index);
      }
    });

    gridContainer.appendChild(tile);
  });
}

/* ==========================================================================
   Lightbox System
   ========================================================================== */
function initLightbox() {
  const backdrop = document.getElementById('galleryLightboxBackdrop');
  const closeBtn = document.getElementById('lightboxCloseBtn');
  const prevBtn = document.getElementById('lightboxPrevBtn');
  const nextBtn = document.getElementById('lightboxNextBtn');

  if (!backdrop) return;

  const closeLightbox = () => {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeLightbox();
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(-1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateLightbox(1);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!backdrop.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });
}

function openLightbox(index) {
  const backdrop = document.getElementById('galleryLightboxBackdrop');
  if (!backdrop || !visibleGalleryItems.length) return;

  currentLightboxIndex = index;
  updateLightboxContent();

  backdrop.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function navigateLightbox(direction) {
  if (!visibleGalleryItems.length) return;
  currentLightboxIndex = (currentLightboxIndex + direction + visibleGalleryItems.length) % visibleGalleryItems.length;
  updateLightboxContent();
}

function updateLightboxContent() {
  const item = visibleGalleryItems[currentLightboxIndex];
  if (!item) return;

  const imgArea = document.getElementById('lightboxImgArea');
  const titleEl = document.getElementById('lightboxTitle');
  const categoryEl = document.getElementById('lightboxCategory');
  const captionEl = document.getElementById('lightboxCaption');
  const locationEl = document.getElementById('lightboxLocation');
  const counterEl = document.getElementById('lightboxCounter');

  if (counterEl) {
    counterEl.textContent = `${currentLightboxIndex + 1} / ${visibleGalleryItems.length}`;
  }

  if (titleEl) titleEl.textContent = item.title;
  if (categoryEl) categoryEl.textContent = item.categoryLabel;
  if (captionEl) captionEl.textContent = item.caption;
  if (locationEl) locationEl.textContent = item.location || 'Faculty of Medicine of Sétif';

  if (imgArea) {
    if (item.isVerifiedPhoto && item.src) {
      imgArea.innerHTML = `
        <img src="${item.src}" alt="${item.title}" class="lightbox-main-img">
      `;
    } else {
      imgArea.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #FFFFFF; max-width: 520px;">
          <div style="width: 64px; height: 64px; border-radius: 16px; background: rgba(0,184,217,0.15); color: #00B8D9; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </div>
          <span style="display: inline-block; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #FCE445; background: rgba(252,228,69,0.15); padding: 5px 14px; border-radius: 999px; margin-bottom: 12px; border: 1px solid rgba(252,228,69,0.3);">
            Pending Photo Upload
          </span>
          <h3 style="font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #FFFFFF;">${item.title}</h3>
          <p style="font-size: 14px; color: #9FB3C8; line-height: 1.6; margin-bottom: 20px;">${item.caption}</p>
          <div style="background: rgba(255,255,255,0.06); border-radius: 12px; padding: 16px; font-size: 12px; color: #D8EEF5; text-align: left; border: 1px solid rgba(255,255,255,0.1);">
            <strong style="display: block; color: #00B8D9; margin-bottom: 4px;">Photographer / Admin Note:</strong>
            To display actual club photography here, place your photo file into the project folder, set <code>src: 'your-photo.jpg'</code> and <code>isVerifiedPhoto: true</code> in <code>js/gallery-data.js</code>.
          </div>
        </div>
      `;
    }
  }
}
