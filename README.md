# Затишна кава — вебзастосунок (лабораторні роботи № 3–5)

Сайт кав'ярні: клієнтська частина (HTML, CSS, JavaScript — ЛР № 3–4) + сервер **Node.js / Express** + база даних **SQLite** + **REST API** (ЛР № 5).

## Швидкий старт
```bash
npm install
cp .env.example .env      # задайте ADMIN_TOKEN (секрет для адмін-маршрутів)
npm start                 # http://localhost:3000
npm test                  # 19 автоматичних тестів API
```
Меню заповнюється автоматично при першому запуску (`server/data/menu.seed.json`). Скинути й заповнити наново: `npm run seed`.

## Структура
```
public/            клієнт: *.html, css/, js/ (api.js — Fetch API), images/, fonts/
server/
  server.js        точка входу
  app.js           Express: helmet (CSP), compression, rate limit, статика, обробка помилок
  db.js            SQLite (better-sqlite3): схема, початкові дані
  validators.js    серверна валідація (правила дзеркалять клієнтські)
  http.js          HttpError, перевірка адміністратора, parseId
  routes/          menu.js, orders.js, bookings.js, feedback.js
tests/api.test.js  тести REST API (node:test)
docs/              скриншоти, журнал взаємодії зі ШІ
```

## REST API
Формат — JSON. Помилки: `{ "error": "...", "errors": { поле: "повідомлення" } }`.
🔒 — потрібен заголовок `Authorization: Bearer <ADMIN_TOKEN>`.

| Метод і шлях | Призначення | Коди |
|---|---|---|
| `GET /api/health` | перевірка стану | 200 |
| `GET /api/menu?category=&q=&sort=` | список меню (фільтр, пошук, сортування) | 200, 400 |
| `GET /api/menu/:id` | одна позиція | 200, 400, 404 |
| 🔒 `POST /api/menu` | створити позицію | 201, 401, 422 |
| 🔒 `PUT /api/menu/:id` | змінити позицію | 200, 401, 404, 422 |
| 🔒 `DELETE /api/menu/:id` | видалити позицію | 204, 401, 404 |
| `POST /api/orders` | створити замовлення (клієнт шле лише `id` і `qty`) | 201, 422 |
| 🔒 `GET /api/orders[?status=]`, `GET /api/orders/:id` | перегляд замовлень | 200, 401, 404 |
| 🔒 `PATCH /api/orders/:id` | змінити статус | 200, 401, 404, 422 |
| 🔒 `DELETE /api/orders/:id` | видалити замовлення | 204, 401, 404 |
| `GET /api/bookings/slots?date=РРРР-ММ-ДД` | стан слотів на день | 200, 400 |
| `POST /api/bookings` | забронювати столик | 201, 409, 422 |
| 🔒 `GET /api/bookings`, `DELETE /api/bookings/:id` | список / скасування | 200, 204, 401, 404 |
| `POST /api/feedback` | надіслати відгук | 201, 422 |
| 🔒 `GET /api/feedback`, `DELETE /api/feedback/:id` | перегляд / видалення | 200, 204, 401, 404 |

## Безпека
Параметризовані SQL-запити; `ORDER BY` лише зі словника; серверна валідація всіх полів; ціни й суми рахує сервер; секрети — у змінних середовища (`.env` у `.gitignore`); адмін-маршрути вимкнені, якщо `ADMIN_TOKEN` не задано; `helmet` із CSP без `unsafe-inline`; обмеження частоти запитів; ліміт розміру тіла 10 КБ; на клієнті дані з БД вставляються лише через `textContent`; детальні помилки сервера в відповіді не показуються.

## Розгортання
**Render** (файл `render.yaml`): New → Blueprint → вибрати репозиторій; у змінних середовища вказати `ADMIN_TOKEN`. Перевірка: `https://<ім'я>.onrender.com/api/health`.
**Docker**: `docker build -t zatyshna-kava . && docker run -p 3000:3000 -e ADMIN_TOKEN=... -v zk-data:/app/data zatyshna-kava`.

> ⚠ SQLite зберігається у файлі. На безкоштовному тарифі Render файлова система тимчасова: після перезапуску замовлення й бронювання зникають, а меню відновлюється із `menu.seed.json`. Для постійного зберігання підключіть диск (`DATABASE_PATH` на його шлях) або перейдіть на PostgreSQL.
