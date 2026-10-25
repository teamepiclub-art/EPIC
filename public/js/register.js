/**
 * EPIC CLUB - Registration & Status Verification Logic
 * Faculty of Medicine of Sétif, Algeria
 */

document.addEventListener('DOMContentLoaded', () => {
  initRegistrationTabs();
  initRegistrationForm();
  initStatusLookup();
  checkUrlParams();
});

function initRegistrationTabs() {
  const tabBtns = document.querySelectorAll('.reg-tab-btn');
  const panels = document.querySelectorAll('.reg-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const panel = document.getElementById(targetId);
      if (panel) panel.classList.add('active');
    });
  });
}

function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const view = urlParams.get('view') || window.location.pathname;

  if (view.includes('status') || code) {
    const statusTab = document.querySelector('[data-tab="statusPanel"]');
    if (statusTab) statusTab.click();
    if (code) {
      const codeInput = document.getElementById('statusCodeInput');
      if (codeInput) {
        codeInput.value = code;
        lookupStatus(code);
      }
    }
  }
}

function initRegistrationForm() {
  const form = document.getElementById('epicRegisterForm');
  if (!form) return;

  const errorBox = document.getElementById('formErrorBox');
  const successBox = document.getElementById('formSuccessBox');
  const submitBtn = document.getElementById('submitRegBtn');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    // Retrieve input values
    const firstName = document.getElementById('regFirstName').value.trim();
    const lastName = document.getElementById('regLastName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const telegram = document.getElementById('regTelegram').value.trim().replace(/^@+/, '');
    const branch = document.getElementById('regBranch').value;
    const year = document.getElementById('regYear').value;
    const matricule = document.getElementById('regMatricule').value.trim();
    const primaryDept = document.getElementById('regPrimaryDept').value;
    const secondaryDept = document.getElementById('regSecondaryDept').value;
    const motivation = document.getElementById('regMotivation').value.trim();

    // Validation
    if (!firstName || !lastName) {
      showError('Please enter your full first name and last name.');
      return;
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      showError('Please provide a valid email address for official correspondence.');
      return;
    }
    if (!phone || phone.length < 9) {
      showError('Please provide a valid Algerian phone number (e.g. 05 / 06 / 07...).');
      return;
    }
    if (!telegram || telegram.length < 3) {
      showError('Please provide your Telegram username (@username) for the secure club communications channel.');
      return;
    }
    if (!branch) {
      showError('Please select your field of study at the Faculty of Medicine.');
      return;
    }
    if (!year) {
      showError('Please select your current academic year of study.');
      return;
    }
    if (!primaryDept) {
      showError('Please select your primary department choice.');
      return;
    }

    // Submit state
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:8px;"></span>
      Processing Application...
    `;

    setTimeout(() => {
      // Generate unique registration code
      const randNum = Math.floor(1000 + Math.random() * 9000);
      const regCode = `EPIC-2026-${randNum}`;

      const registrationRecord = {
        code: regCode,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        email,
        phone,
        telegram: `@${telegram}`,
        branch,
        year,
        matricule: matricule || 'N/A',
        primaryDept,
        secondaryDept: secondaryDept || 'None',
        motivation,
        status: 'PENDING REVIEW',
        statusNote: 'Your application has been received and is queued for verification by the HR Department.',
        submittedAt: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };

      // Save to localStorage
      saveRegistration(registrationRecord);

      // Render success screen
      renderSuccessScreen(registrationRecord);
    }, 1200);
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function saveRegistration(record) {
  try {
    const existing = JSON.parse(localStorage.getItem('epic_registrations') || '[]');
    existing.unshift(record);
    localStorage.setItem('epic_registrations', JSON.stringify(existing));
    localStorage.setItem('epic_last_registration', JSON.stringify(record));
  } catch (e) {
    console.error('Storage error:', e);
  }
}

function renderSuccessScreen(record) {
  const formWrap = document.getElementById('registrationFormWrapper');
  const successWrap = document.getElementById('registrationSuccessWrapper');
  
  if (formWrap) formWrap.style.display = 'none';
  if (successWrap) {
    successWrap.style.display = 'block';
    
    document.getElementById('resCode').textContent = record.code;
    document.getElementById('resName').textContent = record.fullName;
    document.getElementById('resDept').textContent = record.primaryDept;
    document.getElementById('resYear').textContent = `${record.branch} — ${record.year}`;
    document.getElementById('resTelegram').textContent = record.telegram;
    
    // Copy code button
    const copyBtn = document.getElementById('copyCodeBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(record.code).then(() => {
          copyBtn.innerHTML = `✓ Copied!`;
          setTimeout(() => {
            copyBtn.innerHTML = `Copy ID`;
          }, 2000);
        });
      });
    }

    successWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function initStatusLookup() {
  const lookupBtn = document.getElementById('lookupStatusBtn');
  const input = document.getElementById('statusCodeInput');

  if (lookupBtn && input) {
    lookupBtn.addEventListener('click', () => {
      const query = input.value.trim();
      if (!query) {
        alert('Please enter your EPIC Registration Code or Telegram username.');
        return;
      }
      lookupStatus(query);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        lookupBtn.click();
      }
    });
  }
}

async function lookupStatus(query) {
  const resultBox = document.getElementById('statusResultBox');
  if (!resultBox) return;

  const cleanQuery = query.trim();
  if (!cleanQuery) return;

  resultBox.style.display = 'block';
  resultBox.innerHTML = `
    <div style="background:#FFFFFF;border:1px solid #D8EEF5;border-radius:14px;padding:24px;text-align:center;">
      <span class="spinner" style="display:inline-block;width:24px;height:24px;border:3px solid #00B8D9;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px;"></span>
      <p style="color:#50667A;font-size:14px;margin:0;">Searching registration database...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/registration-status?query=' + encodeURIComponent(cleanQuery));
    const data = await res.json();

    if (res.ok && data.success && data.data) {
      const match = data.data;
      const statusColor = match.status === 'Confirmed' ? '#35BFA3' : (match.status === 'Rejected' ? '#DE350B' : '#00B8D9');
      const statusBg = match.status === 'Confirmed' ? 'rgba(53,191,163,0.12)' : (match.status === 'Rejected' ? 'rgba(222,53,11,0.12)' : 'rgba(0,184,217,0.12)');

      resultBox.innerHTML = `
        <div style="background:#FFFFFF;border:1px solid #D8EEF5;border-radius:16px;padding:28px;box-shadow:0 8px 24px rgba(16,42,67,0.06);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(16,42,67,0.08);">
            <div>
              <span style="font-family:'Space Mono',monospace;font-size:12px;color:#00B8D9;font-weight:700;">REGISTRATION RECORD</span>
              <h3 style="font-size:22px;color:#102A43;margin-top:4px;">${escapeHtml(match.fullName)}</h3>
            </div>
            <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;font-family:'Space Mono',monospace;background:${statusBg};color:${statusColor};border:1px solid ${statusColor};">
              ● ${match.status.toUpperCase()}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px;">
            <div>
              <small style="display:block;font-size:11px;color:#829AB1;text-transform:uppercase;">Registration Reference</small>
              <strong style="font-family:'Space Mono',monospace;color:#00B8D9;font-size:16px;">${escapeHtml(match.registrationNumber)}</strong>
            </div>
            <div>
              <small style="display:block;font-size:11px;color:#829AB1;text-transform:uppercase;">Submission Date</small>
              <span style="color:#627D98;font-size:13px;">${new Date(match.createdAt).toLocaleDateString()}</span>
            </div>
            <div>
              <small style="display:block;font-size:11px;color:#829AB1;text-transform:uppercase;">Telegram Verified</small>
              <span style="color:#102A43;font-size:13px;font-weight:600;">${match.telegramLinked ? '✓ Connected' : 'Pending Verification'}</span>
            </div>
          </div>
          <div style="background:#F4FBFD;border-radius:10px;padding:14px 18px;border-left:4px solid ${statusColor};">
            <strong style="display:block;font-size:13px;color:#102A43;margin-bottom:4px;">Status Note:</strong>
            <p style="font-size:13px;color:#50667A;margin:0;">${escapeHtml(match.statusNote)}</p>
          </div>
        </div>
      `;
    } else {
      resultBox.innerHTML = `
        <div style="background:#FFFFFF;border:1px solid #FFEBE6;border-radius:14px;padding:24px;text-align:center;">
          <span style="font-size:28px;display:block;margin-bottom:8px;">🔍</span>
          <h4 style="color:#DE350B;margin-bottom:8px;">No Registration Found</h4>
          <p style="font-size:14px;color:#627D98;margin-bottom:16px;">We could not find an active registration matching "<strong>${escapeHtml(cleanQuery)}</strong>". Please ensure your reference format is correct (e.g. EPIC-2026-XXXX).</p>
          <button onclick="document.querySelector('[data-tab=\\'formPanel\\']').click()" class="btn btn-primary" style="padding:10px 20px;font-size:13px;">Register Now</button>
        </div>
      `;
    }
  } catch (err) {
    resultBox.innerHTML = `
      <div style="background:#FFFFFF;border:1px solid #FFEBE6;border-radius:14px;padding:24px;text-align:center;">
        <h4 style="color:#DE350B;margin-bottom:8px;">Lookup Error</h4>
        <p style="font-size:14px;color:#627D98;">Unable to reach the registration server. Please try again in a few moments.</p>
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
