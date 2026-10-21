# Gamemode Tag — Vote Site for Challenger Strawberry Park

Players vote for the next Tag gamemode. Results refresh every minute (every player's page updates at the same time). The admin can log in to add, edit and delete gamemodes, open or close voting, and reset votes to start a new round.

- Vote page: `index.html`
- Admin panel: `admin.html` (log in at the top of the vote page, then tap **Admin panel**)
- Admin login: set in `secret.php` (kept off GitHub — copy `secret.example.php` to make one)
- Votes reset automatically every day at midnight, and yesterday's winner is shown at the top

No database is needed. Votes are saved in `data/votes.json`, which is created automatically.

## Put it on InfinityFree

1. Sign up at infinityfree.com and create a hosting account (pick a free subdomain such as `gamemodetag.infinityfreeapp.com`).
2. Open the **Control Panel → Online File Manager** (or use FileZilla with the FTP details from your account page).
3. Go into the **`htdocs`** folder and delete the default `index2.html` file if there is one.
4. Upload **everything inside** this `gamemode-tag` folder into `htdocs`:
   ```
   htdocs/
     index.html
     admin.html
     api.php
     config.php
     secret.php   (your admin login — upload this too)
     assets/  (style.css, app.js, admin.js, logo.png)
     data/    (.htaccess, index.html)
   ```
   Make sure the hidden `data/.htaccess` file gets uploaded too. It stops people from downloading the vote file.
5. Visit your domain. The site should show 3 starter gamemodes (Classic Tag, Freeze Tag, Infection). Go to `/admin.html` to log in and change them.

New InfinityFree domains can take up to 72 hours before they work everywhere. If you see "Could not open data file", set the `data` folder's permissions to `755` in the File Manager.

The admin login (`ADMIN_USER` / `ADMIN_PASS`) is in `secret.php`.

## Settings (`config.php`)

| Setting | What it does |
|---|---|
| `DAILY_RESET` | `true` = clear votes every day automatically |
| `RESET_HOUR` | Hour the daily reset happens (0 = midnight) |
| `TIMEZONE` | Your time zone, default `America/Los_Angeles` (Pacific, handles PST/PDT) |
| `REFRESH_SECONDS` | How often results update (default 60) |
| `MAX_VOTES_PER_IP` | Max votes from one Wi-Fi/connection (default 5, so friends on the same Wi-Fi can still vote) |

## How voting works

- Each browser gets one vote. Tap a different mode to switch your vote, or tap your current vote to remove it.
- **Close voting** freezes the results so you can announce the winner.
- **Every day at midnight** votes clear on their own and a new round starts. No cron job is needed: the first visit after midnight does the reset.
- **Reset votes & start new round** clears every vote and opens voting again.
- Deleting a gamemode also deletes the votes for it.

## Test it on your own computer (optional)

```bash
php -S localhost:8000
```
Then open http://localhost:8000.
