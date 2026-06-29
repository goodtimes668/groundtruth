# GroundTruth — GT Mann

What's actually happening on site vs what the office Excel thinks is happening. Foreman runs a 90-second daily check-in from his phone, drift flags propagate to Slack and a desktop dashboard Michael can pull up in real time.

The fourth and final piece of the GT Mann toolkit. Same stack as Site Lock, ToolVault, PunchTrack: Express + lowdb on Railway, vanilla JS PWA on Netlify.

---

## What it actually solves

The office schedule is in Excel or MS Project. The site reality drifts daily — weather, inspectors, RFIs, deliveries, manpower. Nobody updates the schedule until Friday's meeting, by which point the drift is a week deep and the conversation is finger-pointing instead of problem-solving.

GroundTruth makes the gap visible in real time. Two views, one app:

**Site view (foreman, mobile).** Live board of all schedule items. Status badges. Drift flags in amber for slipping, red for blocked. Tap the big "Daily check-in" button → a wizard walks through each open item one at a time, big status buttons, optional notes. 90 seconds from coffee to clean.

**Office view (Michael, desktop).** Same data, different layout. Drift snapshot at top (blocked / slipping / should-have-started). Below it, a 21-day Gantt timeline with today-line and color-coded bars. He pulls this up before an owner meeting and answers "where are we?" in 10 seconds instead of calling foremen.

---

## Repo layout

```
groundtruth-gtmann/
├── backend/         → Railway (Express + lowdb)
└── frontend/        → Netlify (vanilla JS PWA, both views)
```

---

## 1. Deploy backend to Railway

```bash
cd backend
git init && git add . && git commit -m "init groundtruth backend"
gh repo create groundtruth-gtmann-backend --public --source=. --push
```

Railway: New project → Deploy from GitHub. Set env vars:
- `SLACK_WEBHOOK_URL` — incoming webhook to `#schedule` (or wherever drift updates should go)
- `SLACK_BOT_TOKEN` — optional, for DMing subs when their items slip

After deploy, open Railway's shell:
```bash
npm run seed       # base subs (one-time)
npm run seed:demo  # demo schedule (rerunnable, for pitch state)
```

---

## 2. Deploy frontend to Netlify

Edit `frontend/app.js` line 2 — point `API_BASE` to your Railway URL.

Push to a new repo, deploy on Netlify. No build command. Add to Home Screen on phone for the foreman PWA experience.

**Office view URL:** Same app, add `?view=office` to the URL. Bookmark on Michael's desktop:
```
https://YOUR-NETLIFY-URL/?view=office
```

The view toggle button in the header switches between the two on the fly. The office view auto-shows the Gantt; the foreman view auto-shows the action bar.

---

## 3. Loading the real schedule

Three options, fastest to slowest:

**Option A — CSV paste (recommended):**
1. Open MS Project / Excel schedule
2. Select the relevant rows (next 3-4 weeks of foreman-controlled work)
3. Copy/paste into the import sheet (📥 icon in the action bar)
4. Format: `Name, Area, Trade, Start (YYYY-MM-DD), End (YYYY-MM-DD)` — tab or comma separated
5. Tap Preview, check for errors, Save all

**Option B — Add one at a time:** Tap +, fill the form. Fast enough for ~10 items.

**Option C — Bulk API:** POST to `/api/schedule/bulk` if you want to script it from a node tool.

---

## Pitch demo sequence

**Phone side (foreman view):**

1. Open the app. Stat strip shows: **2 on track, 1 slipping (+1d), 1 blocked, 1 total day slipped.**
2. Items below sort by severity. **L2 Electrical rough-in — blocked, waiting on RFI #14** at the top. L2 MEP rough-in slipping +1d. L2 Framing should-have-started in blue.
3. Tap "Daily check-in." Wizard opens. Walks through each open item one at a time. Big tappable status buttons. 90 seconds, done.
4. Slack pings every status change.

**Desktop side (office view — show Michael on a laptop):**

5. Same URL with `?view=office`. Drift snapshot at top — same items, more density. Below: 21-day Gantt with today-line, color-coded bars (blue = on track, amber = slipping, red = blocked, gray = planned, faded = done).
6. Tap CSV export — drops a file ready for the owner meeting.

**The closing line:** "This is the schedule. Live. Updated by me from my phone, twice a day. You see it as it actually is, not what we wrote down three weeks ago."

That's the difference between "we'll regroup Monday" and "this is happening Monday at 7 AM, I'll have Carlos move to L3 instead." Decisions on real data.

---

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/schedule` | All items with computed `flag` and `daysShift`. Filters: `trade`, `area`, `status`, `flag`, `window` |
| POST | `/api/schedule` | Add `{name, trade, plannedStart, plannedEnd, ...}` |
| POST | `/api/schedule/bulk` | CSV import endpoint |
| PATCH | `/api/schedule/:id` | Edit dates / sub / notes |
| DELETE | `/api/schedule/:id` | Remove |
| POST | `/api/schedule/:id/check-in` | `{status, by, notes}` — the daily update |
| GET | `/api/drift` | Slipping + blocked + should-have-started summary |
| GET | `/api/look-ahead?days=7` | Forward window for staging conversations |
| POST | `/api/drift/post` | Push the daily drift summary to Slack manually |
| GET | `/api/export.csv` | Download CSV for owner meetings |
| GET | `/api/subs` | Sub list |

---

## What's intentionally not in v1

- Voice-driven check-in ("framing on track, MEP two days behind") — easy add via Web Speech API + Anthropic API parsing. Skipped to keep MVP focused.
- Dependency graphs (this depends on that) — current model tracks dates only. Adding a dependency field is straightforward when needed.
- Auto-shift downstream items when an upstream item slips — explicit human update keeps trust in the data. Auto-propagation can mask real problems.
- Excel/MS Project file parsing — copy/paste covers 95% of real workflow. Building xlsx/mpp readers is months of work for marginal gain.
- Sub portal (like PunchTrack has) — drift mostly affects the GC's decisions, not the sub's day-to-day. Add later if subs ask for it.

Ship it. Run it for two weeks. See what's missing.
