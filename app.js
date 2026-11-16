/* Збирання Express-застосунку: безпека, API-маршрути, статика, обробка помилок. */
"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { HttpError } = require("./http");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function createApp(db, options = {}) {
  const { rateLimiting = true } = options;
  const app = express();
  app.disable("x-powered-by");
  // за проксі хмарної платформи (Render, Railway тощо) потрібне коректне визначення IP для обмеження запитів
  if (process.env.TRUST_PROXY) { app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1); }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
      }
    }
  }));
  app.use(compression());

  /* ---------- API ---------- */
  const api = express.Router();
  api.use(express.json({ limit: "10kb" }));
  api.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  if (rateLimiting) {
    // загальне обмеження та жорсткіше — для запитів, що записують дані
    const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
      message: { error: "Забагато запитів. Спробуйте за хвилину." } });
    const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: options.writeLimit || 30,
      standardHeaders: "draft-7", legacyHeaders: false,
      message: { error: "Забагато надсилань. Спробуйте пізніше." } });
    api.use(readLimiter);
    api.use((req, res, next) => (req.method === "POST" ? writeLimiter(req, res, next) : next()));
  }

  api.get("/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });
  api.use("/menu", require("./routes/menu")(db));
  api.use("/orders", require("./routes/orders")(db));
  api.use("/bookings", require("./routes/bookings")(db));
  api.use("/feedback", require("./routes/feedback")(db));
  api.use((_req, _res, next) => next(new HttpError(404, "Маршрут не знайдено.")));
  app.use("/api", api);

  /* ---------- Статичний клієнт ---------- */
  app.use(express.static(PUBLIC_DIR, {
    extensions: ["html"],
    setHeaders(res, file) {
      // HTML перевіряється щоразу, ресурси (css, js, шрифти, зображення) кешуються
      res.setHeader("Cache-Control", file.endsWith(".html") ? "no-cache" : "public, max-age=86400");
    }
  }));

  /* ---------- Помилки ---------- */
  app.use((req, res, next) => next(new HttpError(404, "Сторінку не знайдено.")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.type === "entity.parse.failed") { status = 400; message = "Некоректний JSON у тілі запиту."; }
    else if (err.type === "entity.too.large") { status = 413; message = "Тіло запиту завелике."; }
    else if (status >= 500 && !(err instanceof HttpError)) {
      console.error(err); // деталі лише в журналі сервера, клієнт їх не бачить
      message = "Внутрішня помилка сервера.";
    }
    if (req.path.startsWith("/api")) {
      return res.status(status).json({ error: message, ...(err.extra || {}) });
    }
    res.status(status).type("text/plain; charset=utf-8").send(message);
  });

  return app;
}

module.exports = { createApp };
