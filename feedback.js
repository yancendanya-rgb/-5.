/* /api/feedback — надсилання відкрите; перегляд і видалення лише для адміністратора. */
"use strict";

const express = require("express");
const V = require("../validators");
const { HttpError, validationError, requireAdmin, parseId } = require("../http");

module.exports = function feedbackRoutes(db) {
  const router = express.Router();

  router.post("/", (req, res) => {
    const { errors, value } = V.feedback(req.body);
    if (Object.keys(errors).length) { throw validationError(errors); }
    const info = db.prepare("INSERT INTO feedback (name, email, rating, message) VALUES (?, ?, ?, ?)")
      .run(value.name, value.email, value.rating, value.message);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.get("/", requireAdmin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM feedback ORDER BY id DESC").all());
  });

  router.delete("/:id", requireAdmin, parseId, (req, res) => {
    const info = db.prepare("DELETE FROM feedback WHERE id = ?").run(req.id);
    if (!info.changes) { throw new HttpError(404, "Відгук не знайдено."); }
    res.status(204).end();
  });

  return router;
};
