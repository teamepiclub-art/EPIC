/**
 * Server-Side Input Validation and Sanitization Module
 * Enforces strict integrity rules on registration data, phone formats, and Telegram identities
 */

function isValidAlgerianPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  const algRegex = /^(?:(?:\+|00)213|0)[567]\d{8}$/;
  return algRegex.test(cleaned);
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('+213')) {
    return '0' + cleaned.slice(4);
  }
  if (cleaned.startsWith('00213')) {
    return '0' + cleaned.slice(5);
  }
  return cleaned;
}

function normalizeTelegram(telegram) {
  if (!telegram || typeof telegram !== 'string') return '';
  return telegram.trim().replace(/^@+/, '');
}

function sanitizeString(str, maxLength = 255) {
  if (!str || typeof str !== 'string') return '';
  // Remove control characters (ASCII 0-31 except tab/newlines)
  let cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

function validateRegistrationInput(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: ['Invalid request payload'] };
  }

  const firstName = sanitizeString(payload.firstName, 60);
  const lastName = sanitizeString(payload.lastName, 60);
  const rawTelegram = sanitizeString(payload.telegramUsername, 40);
  const rawPhone = sanitizeString(payload.phoneNumber, 30);
  const fieldOfStudy = sanitizeString(payload.fieldOfStudy || payload.branch, 80);
  const academicYear = sanitizeString(payload.academicYear || payload.year, 80);
  const matricule = sanitizeString(payload.matricule, 50);
  const primaryDepartment = sanitizeString(payload.primaryDepartment || payload.primaryDept, 100);
  const secondaryDepartment = sanitizeString(payload.secondaryDepartment || payload.secondaryDept, 100);
  const motivation = sanitizeString(payload.motivation, 1200);

  // 1. First Name Validation
  if (!firstName) {
    errors.push('First Name is required.');
  } else if (firstName.length < 2) {
    errors.push('First Name must be at least 2 characters.');
  }

  // 2. Last Name Validation
  if (!lastName) {
    errors.push('Last Name is required.');
  } else if (lastName.length < 2) {
    errors.push('Last Name must be at least 2 characters.');
  }

  // 3. Telegram Username Validation
  const telegramUsername = normalizeTelegram(rawTelegram);
  const telegramRegex = /^[A-Za-z0-9_]{3,32}$/;
  if (!telegramUsername) {
    errors.push('Telegram Username is required.');
  } else if (!telegramRegex.test(telegramUsername)) {
    errors.push('Please enter a valid Telegram username (3-32 letters, numbers, or underscores).');
  }

  // 4. Phone Number Validation
  if (!rawPhone) {
    errors.push('Phone Number is required.');
  } else if (!isValidAlgerianPhone(rawPhone)) {
    errors.push('Please enter a valid Algerian phone number (e.g., 05XX XX XX XX, 06XX XX XX XX, 07XX XX XX XX, or +213).');
  }

  // 5. Academic Profile Validation
  if (!fieldOfStudy) {
    errors.push('Please select your Field of Study.');
  }
  if (!academicYear) {
    errors.push('Please select your Academic Year.');
  }
  if (!primaryDepartment) {
    errors.push('Please select your Primary Department Choice.');
  }

  const normalizedPhone = normalizePhone(rawPhone);

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      firstName,
      lastName,
      telegramUsername,
      phoneNumber: rawPhone,
      normalizedPhone,
      fieldOfStudy,
      academicYear,
      matricule,
      primaryDepartment,
      secondaryDepartment: secondaryDepartment || 'None',
      motivation
    }
  };
}

module.exports = {
  isValidAlgerianPhone,
  normalizePhone,
  normalizeTelegram,
  sanitizeString,
  validateRegistrationInput
};
