/* Ручне заповнення БД: npm run seed (з --reset очищає меню й заповнює наново). */
"use strict";
require("dotenv").config({ quiet: true });
const { openDatabase, seedMenu } = require("./db");

const db = openDatabase();
const added = seedMenu(db, { reset: process.argv.includes("--reset") });
console.log(added ? "Додано позицій меню: " + added : "Меню вже заповнене — нічого не змінено.");
db.close();
