# Forge

A personal toolkit — a collection of self-hosted web apps running on a local Node/Express server.

## Apps

| App | Path | Description |
|-----|------|-------------|
| **Calorie Tracker** | `/calories.html` | Log food, track macros, scan barcodes, calculate TDEE, log weight with Withings sync |
| **Fitness Tracker** | `/fitness.html` | Manage workout plans, log sessions, track lifts over time with RPE and plate calculator |
| **Meal Planner** | `/meals.html` | Build recipes from ingredients, import from URLs, generate grocery lists, AI meal prep planner |
| **Plant Tracker** | `/plants.html` | Track plant health, log care events, get AI-suggested watering schedules, identify plants from photos |
| **Fantasy Draft** | `/draft.html` | Live Sleeper data, tier rankings, VOR scoring, positional need analysis |
| **Settings** | `/settings.html` | Timezone, goals, Withings OAuth connection |

## Stack

- **Frontend** — Vanilla HTML/CSS/JS, no build step
- **Backend** — Node.js + Express (`server.js`)
- **Data** — Single JSON file (`data.json`), shared across all apps via `/api/state`
- **AI** — Anthropic Claude API (recipe import, meal prep planning, plant identification, care interval suggestions)
- **Integrations** — Withings scale (OAuth2), USDA food database, Open Food Facts barcode lookup

## PWA

The app is installable as a standalone PWA on iOS and Android.

- **iOS (Safari):** Share → Add to Home Screen
- **Android (Chrome):** Menu → Add to Home Screen / Install app

## This repository

Only the `public/` folder is tracked — HTML, CSS, JS, icons, and the service worker. The server, credentials, and data files are local only.
