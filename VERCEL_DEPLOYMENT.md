# دليل نشر بوابة نادي EPIC على Vercel
# Vercel Deployment Guide for EPIC CLUB Portal

دليل شامل لنشر منصة ونظام إدارة طلبات انضمام نادي **EPIC CLUB** على منصة **Vercel** السحابية باستخدام قاعدة بيانات **Neon PostgreSQL**.

---

## ⚡ الميزات والتقنيات المستخدمة في النشر السحابي
- **Vercel Serverless Functions:** جميع نقاط الـ API تعمل كدوال سحابية في مسار `/api/*`.
- **Neon Serverless PostgreSQL:** اتصال سريع عبر HTTP باستخدام `@neondatabase/serverless` متوافق 100% مع بيئة Serverless.
- **Telegram Bot Webhook:** استقبال ومعالجة تفاعلات البوت وإرسال روابط الدعوة ذات الاستخدام الواحد (`member_limit = 1`).
- **واجهة إدارة مدمجة (`/admin`):** تحكم كامل في مراجعة وقبول ورفض الطلبات، وتتبع سجلات التدقيق (Audit Logs).

---

## 📋 الخطوات العملية للنشر

### 1. إنشاء قاعدة بيانات على Neon (مجاناً)
1. قم بزيارة [Neon.tech](https://neon.tech) وسجل الدخول باستخدام GitHub.
2. أنشئ مشروعاً جديداً (مثال: `epic-portal-db`).
3. انسخ رابط الاتصال المباشر **Connection String** الذي يظهر بالشكل:
   ```text
   postgresql://[user]:[password]@[endpoint].eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

---

### 2. استيراد المشروع في Vercel
1. توجه إلى [Vercel Dashboard](https://vercel.com/new).
2. اختر **Import Git Repository** واختر مستودعك:
   `https://github.com/teamepiclub-art/EPIC`
3. اختر الإعدادات التالية:
   - **Framework Preset:** `Other`
   - **Root Directory:** `.`
   - **Build Command:** اتركها فارغة (تلقائي)
   - **Output Directory:** اتركها فارغة (تلقائي)

---

### 3. إعداد متغيرات البيئة (Environment Variables)
في إعدادات المشروع في Vercel (قسم **Environment Variables**)، أضف المتغيرات التالية:

| المتغير (Key) | الوصف / القيمة |
|---|---|
| `DATABASE_URL` | رابط اتصال قاعدة بيانات Neon PostgreSQL الذي نسخته |
| `INIT_SECRET` | كلمة سر لحماية نقطة تهيئة قاعدة البيانات (مثال: `epic_init_secret_2026_super`) |
| `ADMIN_DEFAULT_USERNAME` | اسم مستخدم المسؤول الافتراضي (مثال: `admin`) |
| `ADMIN_DEFAULT_PASSWORD` | كلمة مرور المسؤول الافتراضي (مثال: `EpicAdmin2026!`) |
| `TELEGRAM_BOT_TOKEN` | توكن البوت الخاص بك من @BotFather |
| `TELEGRAM_BOT_USERNAME` | يوزرنيم البوت (مثال: `epicbazbot`) |
| `TELEGRAM_TARGET_CHAT_ID` | معرّف المجموعة أو القناة المستهدفة (مثال: `-1004375944672`) |
| `TELEGRAM_WEBHOOK_SECRET` | رمز سري لحماية Webhook التيليجرام |
| `SESSION_SECRET` | مفتاح سري عشوائي لتشفير الجلسات |
| `SESSION_MAX_AGE_HOURS` | مدة الجلسة بالساعات (مثال: `8`) |
| `LINKING_TOKEN_EXPIRY_HOURS` | صلاحية رمز ربط التيليجرام بالساعات (مثال: `48`) |
| `NODE_ENV` | `production` |

ثم اضغط **Deploy**.

---

### 4. تهيئة الجداول وحساب المسؤول (تُنفذ مرة واحدة فقط)
بعد اكتمال أول عملية نشر وحصولك على رابط موقعك على Vercel:

نفذ الأمر التالي في Terminal / PowerShell:
```bash
curl -X POST https://YOUR-VERCEL-DOMAIN.vercel.app/api/admin/init-db \
  -H "Content-Type: application/json" \
  -H "x-init-secret: YOUR_INIT_SECRET" \
  -d "{}"
```

ستتلقى الاستجابة:
```json
{
  "success": true,
  "message": "Database schema initialized and default admin seeded successfully."
}
```

---

### 5. تفعيل الـ Webhook لبوت التيليجرام
لتفعيل تفاعل البوت التلقائي عبر الويب، افتح الرابط التالي في المتصفح مرة واحدة:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR-VERCEL-DOMAIN>.vercel.app/api/telegram/webhook&secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>
```

---

## 🔒 الأمان وحماية البيانات
- **كلمات المرور:** مشفرة باستخدام `PBKDF2` مع `Salt` فريد لكل حساب.
- **التوجيه المقيد:** ملف `vercel.json` يحدد رؤوس الأمان (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`).
- **المعاملات البارامترية:** جميع استعلامات SQL محمية بالكامل ضد ثغرات SQL Injection.
