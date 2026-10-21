# Gamemode Tag — Vote Site for Challenger Strawberry Park

Players vote for the next Tag gamemode. Results refresh every minute, at the same moment for everyone. The admin logs in at the top of the vote page, then taps **Admin panel** to add, edit and delete gamemodes, open or close voting, and reset votes.

- **Hosting:** GitHub Pages (the website files in this repo)
- **Database:** Supabase, free (votes, gamemodes, admin login)
- **Daily reset:** votes clear every day at midnight Pacific time (PST/PDT), and yesterday's winner is shown at the top

## Files

| File | What it is |
|---|---|
| `index.html` | Vote page |
| `admin.html` | Admin panel |
| `assets/supabase-config.js` | Your Supabase project URL and public (anon) key |
| `assets/api.js` | Talks to Supabase |
| `supabase/setup.sql` | Creates the database. Run once in Supabase |

## Set up Supabase (one time)

1. Create a free project at supabase.com.
2. In the project, open **SQL Editor → New query**, paste all of `supabase/setup.sql`, and click **Run**.
3. Set your admin login. In a new SQL Editor query, type this with your own password and click **Run**:
   ```sql
   select gt_set_admin_login('Uncapped', 'your-password-here');
   ```
   The password is stored scrambled (bcrypt) and never appears in this repo. Run it again any time to change the password. Doing so also logs the admin out everywhere.
4. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key into `assets/supabase-config.js`.

The anon key is meant to be public. It can only call the `gt_*` functions in `setup.sql`, and the tables are locked against direct access.

## Put it on GitHub Pages

1. The repo must be public (free GitHub accounts only get Pages on public repos).
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**.
3. After a minute the site is live at `https://<your-username>.github.io/gamemode-tag/`.

## Settings

Change these in Supabase (**Table Editor → gt_settings**):

| Column | What it does |
|---|---|
| `daily_reset` | `true` = clear votes every day automatically |
| `reset_hour` | Hour the daily reset happens (0 = midnight) |
| `timezone` | Default `America/Los_Angeles` (Pacific, handles PST/PDT) |
| `refresh_seconds` | How often results update (default 60) |
| `max_votes_per_ip` | Max votes from one Wi-Fi/connection (default 5, so friends on the same Wi-Fi can still vote) |

## How voting works

- Each browser gets one vote. Tap a different mode to switch your vote, or tap your current vote to remove it.
- **Close voting** freezes the results so you can announce the winner.
- **Every day at midnight** votes clear on their own and a new round starts. No scheduled job is needed: the first visit after midnight does the reset.
- **Reset votes & start new round** clears every vote right away.
- Deleting a gamemode also deletes its votes.
