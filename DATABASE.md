# EPIC CLUB Registration System — Backend & Database Architecture

This document describes the database schema, security controls, models, migrations, and environment configuration for the **EPIC CLUB Registration System** (Faculty of Medicine of Sétif, Algeria).

---

## 1. Stack & Design Principles

- **Engine:** Built-in Native SQLite via `node:sqlite` (Node.js 22.5+ / 25+).
- **Zero-Dependency Philosophy:** Preserves the existing zero-dependency architecture. Eliminates C++ compiler requirements (`node-gyp`) on Windows while providing standard SQL ACID compliance, foreign keys, and WAL journal mode.
- **SQL Injection Prevention:** 100% parameterized queries using prepared statements (`db.prepare(...).get() / .all() / .run()`). No string interpolation in queries.
- **Role-Based Access Control:** Secure HTTP-only cookies and Bearer tokens for administration sessions, PBKDF2/SHA-512 password hashing with cryptographically random salts, and constant-time equality checks (`crypto.timingSafeEqual`).
- **Audit Logging:** Every administrative mutation and lifecycle event is logged in `audit_logs` with actor ID, affected registration, timestamp, outcome, and sanitized context.

---

## 2. Relational Data Models

### 2.1 `registrations` Table
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY` | Internal unique identifier (UUID v4) |
| `registration_number` | `TEXT` | `UNIQUE NOT NULL` | Public registration code (e.g., `EPIC-2026-XXXX`) |
| `first_name` | `TEXT` | `NOT NULL` | Applicant first name (sanitized, 2–60 chars) |
| `last_name` | `TEXT` | `NOT NULL` | Applicant last name (sanitized, 2–60 chars) |
| `telegram_username` | `TEXT` | `NOT NULL` | Normalized Telegram username (without `@`) |
| `telegram_chat_id` | `INTEGER` | `NULLABLE` | Verified Telegram Chat ID (linked via deep link) |
| `phone_number` | `TEXT` | `NOT NULL` | Raw phone number as entered |
| `normalized_phone` | `TEXT` | `NOT NULL` | Normalized Algerian phone (`0XXXXXXXXX`) |
| `status` | `TEXT` | `NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Rejected'))` | Application status |
| `linking_token` | `TEXT` | `UNIQUE NOT NULL` | Deep link token for Telegram bot account linking |
| `telegram_linked_at`| `TEXT` | `NULLABLE` | ISO 8601 timestamp of verified bot connection |
| `telegram_invite_status` | `TEXT` | `NOT NULL CHECK (...)` | Delivery tracking status |
| `rejection_reason` | `TEXT` | `NULLABLE` | Reason provided by admin if rejected |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 creation timestamp |
| `updated_at` | `TEXT` | `NOT NULL` | ISO 8601 modification timestamp |
| `confirmed_at` | `TEXT` | `NULLABLE` | Confirmation timestamp |
| `confirmed_by` | `TEXT` | `NULLABLE REFERENCES admins(id)` | ID of the administrator who approved |

#### Uniqueness Rule:
- Active duplicate prevention is anchored on `normalized_phone` (Algerian mobile number) through a conditional unique index:
  ```sql
  CREATE UNIQUE INDEX uq_active_registration_phone
  ON registrations (normalized_phone)
  WHERE status IN ('Pending', 'Confirmed');
  ```
- A Telegram username is never treated as a guaranteed identity token because Telegram handles can change or be transferred; verification is anchored on `phone_number` and verified `telegram_chat_id`.

---

### 2.2 `invitations` Table
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY` | Unique invitation record UUID |
| `registration_id` | `TEXT` | `NOT NULL REFERENCES registrations(id) ON DELETE CASCADE` | Affected applicant |
| `target_group_identifier` | `TEXT` | `NOT NULL` | Telegram channel or group chat ID (e.g. `-1002345678901`) |
| `invite_link` | `TEXT` | `NULLABLE` | Unique single-use Telegram link (`member_limit = 1`) |
| `expiry_timestamp` | `INTEGER`| `DEFAULT 0` | Unix epoch expiry timestamp (0 = no expiry) |
| `status` | `TEXT` | `NOT NULL CHECK (...)` | `Pending`, `Sent`, `Delivered`, `Failed`, `Revoked` |
| `created_at` | `TEXT` | `NOT NULL` | Generation timestamp |
| `sent_at` | `TEXT` | `NULLABLE` | Private Telegram dispatch timestamp |
| `revoked_at` | `TEXT` | `NULLABLE` | Revocation timestamp |
| `last_error` | `TEXT` | `NULLABLE` | Sanitized error description without secrets |

---

### 2.3 `audit_logs` Table
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | Auto-incrementing log ID |
| `actor_id` | `TEXT` | `NOT NULL` | Admin ID, or `'applicant'` / `'telegram_bot'` |
| `actor_username` | `TEXT` | `NOT NULL` | Display username of the actor |
| `action` | `TEXT` | `NOT NULL` | Lifecycle event code |
| `affected_registration_id` | `TEXT` | `NULLABLE` | Public registration number (`EPIC-2026-XXXX`) |
| `outcome` | `TEXT` | `NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE'))` | Outcome |
| `details` | `TEXT` | `NULLABLE` | Sanitized description (all tokens/secrets redacted) |
| `ip_address` | `TEXT` | `NULLABLE` | Request IP address |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 timestamp |

---

### 2.4 `admins` & `admin_sessions` Tables
- `admins`: Stores administrators with PBKDF2/SHA-512 hashed passwords, unique salts, and roles (`SuperAdmin`, `Admin`, `Reviewer`).
- `admin_sessions`: Active cryptographic session tokens with expiration and cascade deletion.
- `system_settings`: Key-value configuration for bot token, bot username, and default group ID.

---

## 3. Database Migrations

Database migrations are stored in [migrations/](file:///d:/machri3/epic%20idarit%20tolab/migrations):
- [001_initial_schema.sql](file:///d:/machri3/epic%20idarit%20tolab/migrations/001_initial_schema.sql): Table definitions, constraints, foreign keys.
- [002_indexes_and_constraints.sql](file:///d:/machri3/epic%20idarit%20tolab/migrations/002_indexes_and_constraints.sql): Indexes for search, status filtering, and phone uniqueness constraint.

### Running Migrations Manually
```bash
npm run migrate
```
Migrations are also run automatically on server boot.

---

## 4. Environment Variables

Create or configure a `.env` file in the root directory (refer to [.env.example](file:///d:/machri3/epic%20idarit%20tolab/.env.example)):

| Variable | Default Value | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP server |
| `NODE_ENV` | `production` | Environment mode (`development` or `production`) |
| `DATABASE_PATH` | `data/epic_club.db` | Filepath for the SQLite database |
| `TELEGRAM_BOT_TOKEN` | `""` | Telegram Bot API Token obtained from `@BotFather` |
| `TELEGRAM_BOT_USERNAME` | `epic_club_setif_bot` | Public username of the club's Telegram bot |
| `TELEGRAM_TARGET_CHAT_ID` | `-1002345678901` | Telegram Group/Channel Chat ID for cohort invites |
| `DEFAULT_EXPIRY_HOURS` | `48` | Default validity period for generated invite links |
| `ADMIN_DEFAULT_USERNAME` | `admin` | Initial SuperAdmin username |
| `ADMIN_DEFAULT_PASSWORD` | `EpicAdmin2026!` | Initial SuperAdmin password |
| `SESSION_MAX_AGE_HOURS` | `8` | Admin session lifetime in hours |

---

## 5. Verification & Testing

Run the automated test suite:
```bash
npm test
```
The test suite validates:
1. Valid registration submission (`POST /api/register`).
2. Input validation for Algerian phone formats.
3. Strict duplicate prevention via phone uniqueness rule (409 Conflict).
4. Registration status lookup without fake fallback.
5. Admin authentication and PBKDF2 verification.
6. Server-side pagination and status filtering.
7. Confirmation workflow and single-use Telegram link generation (`member_limit = 1`).
8. Telegram deep-link account linking.
9. Single-use invitation revocation.
10. Immutable audit log record keeping.
