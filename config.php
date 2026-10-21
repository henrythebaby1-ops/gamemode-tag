<?php
// Gamemode Tag — settings
// Change these to whatever you like. This file is never sent to visitors.

define('SITE_TITLE', 'Gamemode Tag');
define('SITE_SUBTITLE', 'Challenger Strawberry Park');

// Admin login lives in secret.php so it never ends up on GitHub.
// Copy secret.example.php to secret.php and put your login in it.
if (file_exists(__DIR__ . '/secret.php')) {
    require __DIR__ . '/secret.php';
}
if (!defined('ADMIN_USER') || !defined('ADMIN_PASS') || ADMIN_PASS === '') {
    // No secret.php yet: admin login stays switched off.
    if (!defined('ADMIN_USER')) define('ADMIN_USER', '');
    if (!defined('ADMIN_PASS')) define('ADMIN_PASS', '');
}

// How often the vote page refreshes results (seconds)
define('REFRESH_SECONDS', 60);

// Max number of votes allowed from one internet connection (IP address).
// Players on the same Wi-Fi share an IP, so keep this above 1.
define('MAX_VOTES_PER_IP', 5);

// Daily reset: every day at RESET_HOUR (0 = midnight) votes clear and a new round starts.
define('DAILY_RESET', true);
define('RESET_HOUR', 0);
// Your time zone, so "midnight" is your midnight. List: https://www.php.net/manual/en/timezones.php
define('TIMEZONE', 'America/Los_Angeles'); // Pacific time (PST/PDT)

define('DATA_FILE', __DIR__ . '/data/votes.json');
