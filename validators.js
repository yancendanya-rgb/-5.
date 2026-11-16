/* Серверна перевірка вхідних даних. Правила дзеркалять клієнтські (validation.js),
   але сервер не довіряє клієнту: перевіряє все ще раз. Кожна функція повертає
   { value, errors }, де errors — об'єкт «поле → повідомлення». */
"use strict";

const CATEGORIES = ["kava", "tea", "cold", "food", "dessert"];
const ORDER_STATUSES = ["new", "preparing", "ready", "done", "cancelled"];
const PAYMENTS = ["card-online", "on-site"];
const PICKUP_SLOTS = ["asap", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
  "12:30", "13:00", "13:30", "14:00", "14:30"];
const BOOKING_SLOTS = [];
for (let h = 11; h <= 20; h++) {
  BOOKING_SLOTS.push(String(h).padStart(2, "0") + ":00", String(h).padStart(2, "0") + ":30");
}
const BOOKING_DAYS_AHEAD = 60;
const BONUS_POINTS = 120;

const NAME_RE = /^[A-Za-zА-Яа-яІіЇїЄєҐґ'’ʼ\-\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// прибираємо керівні символи (крім переведення рядка в текстових полях)
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(value) {
  return typeof value === "string" ? value.replace(CONTROL_RE, "").trim() : "";
}

function name(raw, errors, field = "name") {
  const v = clean(raw);
  if (!v) { errors[field] = "Вкажіть ім’я."; }
  else if (v.length < 2) { errors[field] = "Ім’я має містити щонайменше 2 символи."; }
  else if (v.length > 60) { errors[field] = "Ім’я не повинно перевищувати 60 символів."; }
  else if (!NAME_RE.test(v)) { errors[field] = "Ім’я може містити лише літери, пробіл, апостроф і дефіс."; }
  return v;
}

function phone(raw, errors, field = "phone") {
  const v = clean(raw);
  if (!v) { errors[field] = "Вкажіть номер телефону."; return v; }
  if (!/^[+\d\s\-()]+$/.test(v)) {
    errors[field] = "Телефон може містити лише цифри, пробіли, дужки, дефіс і «+».";
    return v;
  }
  const digits = v.replace(/\D/g, "");
  if (/^380\d{9}$/.test(digits)) { return "+" + digits; }
  if (/^0\d{9}$/.test(digits)) { return "+38" + digits; }
  errors[field] = "Введіть український номер: +380 XX XXX XX XX або 0XX XXX XX XX.";
  return v;
}

function text(raw, errors, field, { max, min = 0, requiredMsg, minMsg, maxMsg }) {
  const v = clean(raw);
  if (!v && min > 0) { errors[field] = requiredMsg; }
  else if (v && v.length < min) { errors[field] = minMsg; }
  else if (v.length > max) { errors[field] = maxMsg; }
  return v;
}

function intInRange(raw, min, max) {
  const n = typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/* Поточна дата й час у Києві (сервер може працювати в іншому часовому поясі) */
function nowInKyiv(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return false; }
  const d = new Date(value + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/* ---------- Меню ---------- */
function menuItem(body) {
  const errors = {};
  const b = body && typeof body === "object" ? body : {};
  const title = text(b.title, errors, "title", {
    min: 2, max: 80, requiredMsg: "Вкажіть назву.", minMsg: "Назва закоротка.", maxMsg: "Назва задовга (до 80 символів)."
  });
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  if (!category) { errors.category = "Категорія має бути однією з: " + CATEGORIES.join(", ") + "."; }
  const price = intInRange(b.price, 1, 10000);
  if (price === null) { errors.price = "Ціна — ціле число від 1 до 10000."; }
  const description = text(b.description, errors, "description", {
    max: 400, maxMsg: "Опис не повинен перевищувати 400 символів."
  });
  const allergens = text(b.allergens, errors, "allergens", { max: 120, maxMsg: "Алергени: до 120 символів." });
  const badge = text(b.badge, errors, "badge", { max: 20, maxMsg: "Позначка: до 20 символів." });
  const image = clean(b.image);
  if (image && !/^images\/[a-z0-9\-]+\.svg$/.test(image)) {
    errors.image = "Зображення має бути з каталогу images/ (формат .svg).";
  }
  const imageAlt = text(b.image_alt, errors, "image_alt", { max: 160, maxMsg: "Альтернативний текст: до 160 символів." });
  return { errors, value: { title, category, price, description, allergens, badge, image, image_alt: imageAlt } };
}

/* ---------- Замовлення ---------- */
function order(body) {
  const errors = {};
  const b = body && typeof body === "object" ? body : {};
  const value = {};
  value.name = name(b.name, errors);
  value.phone = phone(b.phone, errors);
  value.note = text(b.note, errors, "note", { max: 200, maxMsg: "Коментар не повинен перевищувати 200 символів." });
  value.pickup = PICKUP_SLOTS.includes(b.pickup) ? b.pickup : null;
  if (!value.pickup) { errors.pickup = "Оберіть час отримання."; }
  value.payment = PAYMENTS.includes(b.payment) ? b.payment : null;
  if (!value.payment) { errors.payment = "Оберіть спосіб оплати."; }
  value.useBonus = b.useBonus === true;

  const merged = new Map();
  if (!Array.isArray(b.items) || b.items.length === 0) {
    errors.items = "Кошик порожній — додайте хоча б одну позицію.";
  } else if (b.items.length > 40) {
    errors.items = "Забагато позицій у замовленні.";
  } else {
    for (const row of b.items) {
      const id = row ? intInRange(row.id, 1, 1e9) : null;
      const qty = row ? intInRange(row.qty, 1, 20) : null;
      if (id === null || qty === null) {
        errors.items = "Кожна позиція має містити id та кількість від 1 до 20.";
        break;
      }
      merged.set(id, (merged.get(id) || 0) + qty);
    }
    for (const qty of merged.values()) {
      if (qty > 20) { errors.items = "Максимум 20 одиниць однієї позиції."; }
    }
  }
  value.items = Array.from(merged, ([id, qty]) => ({ id, qty }));
  return { errors, value };
}

/* ---------- Бронювання ---------- */
function booking(body, now = new Date()) {
  const errors = {};
  const b = body && typeof body === "object" ? body : {};
  const value = {};
  const today = nowInKyiv(now);

  value.date = typeof b.date === "string" ? b.date.trim() : "";
  if (!value.date) { errors.date = "Оберіть дату візиту."; }
  else if (!isRealDate(value.date)) { errors.date = "Некоректна дата. Формат: РРРР-ММ-ДД."; }
  else if (value.date < today.date) { errors.date = "Дата не може бути в минулому."; }
  else if (value.date > addDays(today.date, BOOKING_DAYS_AHEAD)) {
    errors.date = "Бронювання доступне не далі ніж на " + BOOKING_DAYS_AHEAD + " днів уперед.";
  }

  value.time = BOOKING_SLOTS.includes(b.time) ? b.time : null;
  if (!value.time) { errors.time = "Оберіть вільний час візиту."; }
  else if (!errors.date && value.date === today.date && value.time <= today.time) {
    errors.time = "Цей час уже минув. Оберіть пізніший.";
  }

  value.guests = intInRange(b.guests, 1, 8);
  if (value.guests === null) { errors.guests = "Кількість гостей — від 1 до 8."; }
  value.name = name(b.name, errors);
  value.phone = phone(b.phone, errors);
  value.note = text(b.note, errors, "note", { max: 200, maxMsg: "Побажання не повинні перевищувати 200 символів." });
  return { errors, value };
}

/* ---------- Відгук ---------- */
function feedback(body) {
  const errors = {};
  const b = body && typeof body === "object" ? body : {};
  const value = {};
  value.name = name(b.name, errors);
  value.email = clean(b.email).toLowerCase();
  if (!value.email) { errors.email = "Вкажіть електронну пошту."; }
  else if (value.email.length > 120 || !EMAIL_RE.test(value.email)) {
    errors.email = "Некоректна адреса. Приклад: name@example.com.";
  }
  value.rating = intInRange(b.rating, 1, 5);
  if (value.rating === null) { errors.rating = "Оберіть оцінку закладу від 1 до 5."; }
  value.message = text(b.message, errors, "message", {
    min: 10, max: 500, requiredMsg: "Напишіть повідомлення.",
    minMsg: "Повідомлення закоротке: напишіть щонайменше 10 символів.",
    maxMsg: "Повідомлення не повинно перевищувати 500 символів."
  });
  return { errors, value };
}

module.exports = {
  CATEGORIES, ORDER_STATUSES, BOOKING_SLOTS, BONUS_POINTS,
  menuItem, order, booking, feedback, nowInKyiv, isRealDate, intInRange
};
