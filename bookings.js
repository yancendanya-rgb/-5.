/* /api/bookings — вільні слоти й створення відкриті; список і скасування лише для адміністратора. */
"use strict";

const express = require("express");
const V = require("../validators");
const { HttpError, validationError, requireAdmin, parseId } = require("../http");

const TABLES_PER_SLOT = Number(process.env.TABLES_PER_SLOT) || 3;

module.exports = function bookingRoutes(db) {
  const router = express.Router();
  const countAt = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND time = ?");

  // GET /api/bookings/slots?date=2026-11-20 — стан усіх слотів на день
  router.get("/slots", (req, res) => {
    const date = req.query.date;
    if (!V.isRealDate(date)) { throw new HttpError(400, "Вкажіть дату у форматі РРРР-ММ-ДД."); }
    const now = V.nowInKyiv();
    const rows = db.prepare("SELECT time, COUNT(*) AS n FROM bookings WHERE date = ? GROUP BY time").all(date);
    const taken = new Map(rows.map((r) => [r.time, r.n]));
    res.json({
      date,
      slots: V.BOOKING_SLOTS.map((time) => ({
        time,
        available: (taken.get(time) || 0) < TABLES_PER_SLOT && !(date < now.date || (date === now.date && time <= now.time))
      }))
    });
  });

  router.post("/", (req, res) => {
    const { errors, value } = V.booking(req.body);
    if (Object.keys(errors).length) { throw validationError(errors); }
    // перевірка й вставка в одній транзакції, щоб два запити не зайняли останній столик одночасно
    const create = db.transaction(() => {
      if (countAt.get(value.date, value.time).n >= TABLES_PER_SLOT) {
        throw new HttpError(409, "На цей час усі столики вже заброньовані. Оберіть інший час.");
      }
      return db.prepare(
        "INSERT INTO bookings (date, time, guests, name, phone, note) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(value.date, value.time, value.guests, value.name, value.phone, value.note).lastInsertRowid;
    });
    const id = Number(create.immediate());
    res.status(201).location("/api/bookings/" + id)
      .json({ id, date: value.date, time: value.time, guests: value.guests });
  });

  router.get("/", requireAdmin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM bookings ORDER BY date, time, id").all());
  });

  router.delete("/:id", requireAdmin, parseId, (req, res) => {
    const info = db.prepare("DELETE FROM bookings WHERE id = ?").run(req.id);
    if (!info.changes) { throw new HttpError(404, "Бронювання не знайдено."); }
    res.status(204).end();
  });

  return router;
};
