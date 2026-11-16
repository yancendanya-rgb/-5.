/* Допоміжні засоби HTTP: помилки, обгортка async-обробників, перевірка адміністратора. */
"use strict";

const crypto = require("crypto");

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

const validationError = (errors) => new HttpError(422, "Некоректні дані.", { errors });

/* Адмін-маршрути захищені токеном із змінної середовища ADMIN_TOKEN (заголовок Authorization: Bearer ...).
   Якщо токен не задано, адмін-функції вимкнені взагалі. */
function requireAdmin(req, _res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return next(new HttpError(503, "Адміністративні функції вимкнено: не задано ADMIN_TOKEN."));
  }
  const header = req.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // порівняння хешів однакової довжини, стійке до атак за часом відповіді
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return next(new HttpError(401, "Потрібна авторизація адміністратора."));
  }
  next();
}

function parseId(req, _res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { return next(new HttpError(400, "Некоректний ідентифікатор.")); }
  req.id = id;
  next();
}

module.exports = { HttpError, validationError, requireAdmin, parseId };
