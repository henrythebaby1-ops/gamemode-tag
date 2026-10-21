<?php
// Gamemode Tag — JSON API used by the vote page and the admin panel.
require __DIR__ . '/config.php';

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ---------- storage ----------

function default_data() {
    return [
        'open' => true,
        'round' => 1,
        'gamemodes' => [
            ['id' => 'classic', 'name' => 'Classic Tag', 'description' => 'One tagger. Get tagged, you\'re it.'],
            ['id' => 'freeze', 'name' => 'Freeze Tag', 'description' => 'Tagged players freeze until a teammate unfreezes them.'],
            ['id' => 'infection', 'name' => 'Infection', 'description' => 'Tagged players join the taggers. Last runner wins.'],
        ],
        'votes' => new stdClass(),
    ];
}

// Opens the data file with a lock, runs $fn on the data, saves if $fn returns true.
function with_data($fn) {
    if (!is_dir(dirname(DATA_FILE))) {
        mkdir(dirname(DATA_FILE), 0755, true);
    }
    $fp = fopen(DATA_FILE, 'c+');
    if (!$fp) {
        respond(['error' => 'Could not open data file. Check that the data folder is writable.'], 500);
    }
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) {
        $data = json_decode(json_encode(default_data()), true);
        $save = true;
    } else {
        $save = false;
    }
    if (!isset($data['votes']) || !is_array($data['votes'])) $data['votes'] = [];
    if (daily_reset($data)) $save = true;

    $result = $fn($data);
    if ($result === true || $save) {
        $out = $data;
        if (empty($out['votes'])) $out['votes'] = new stdClass();
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $data;
}

// ---------- daily reset ----------

// The "day" a moment belongs to, counting from RESET_HOUR (e.g. 2026-10-20).
function reset_day($ts) {
    $d = new DateTime('@' . ($ts - RESET_HOUR * 3600));
    $d->setTimezone(new DateTimeZone(TIMEZONE));
    return $d->format('Y-m-d');
}

// Timestamp of the next reset.
function next_reset_time() {
    $tz = new DateTimeZone(TIMEZONE);
    $d = new DateTime('now', $tz);
    $d->setTime(RESET_HOUR, 0, 0);
    if ($d->getTimestamp() <= time()) $d->modify('+1 day');
    return $d->getTimestamp();
}

// Runs on every request. No cron needed: the first visit of a new day does the reset.
function daily_reset(&$d) {
    if (!DAILY_RESET) return false;
    $today = reset_day(time());
    if (!isset($d['day'])) { $d['day'] = $today; return true; }
    if ($d['day'] === $today) return false;

    // Remember the winner before clearing.
    $counts = [];
    foreach ($d['votes'] as $v) $counts[$v['gm']] = ($counts[$v['gm']] ?? 0) + 1;
    if ($counts) {
        arsort($counts);
        $topId = array_key_first($counts);
        foreach ($d['gamemodes'] as $gm) {
            if ($gm['id'] === $topId) {
                $d['lastWinner'] = ['name' => $gm['name'], 'votes' => $counts[$topId], 'day' => $d['day']];
            }
        }
    }
    $d['votes'] = [];
    $d['round'] = (int)($d['round'] ?? 1) + 1;
    $d['open'] = true;
    $d['day'] = $today;
    return true;
}

// ---------- helpers ----------

function respond($payload, $code = 200) {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function is_admin() {
    return !empty($_SESSION['admin']);
}

function require_admin() {
    if (!is_admin()) respond(['error' => 'Admin login required.'], 403);
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['csrf'] ?? '', $token)) respond(['error' => 'Session expired. Log in again.'], 403);
}

function voter_id() {
    $id = $_COOKIE['gt_voter'] ?? '';
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        $id = bin2hex(random_bytes(16));
        setcookie('gt_voter', $id, [
            'expires' => time() + 60 * 60 * 24 * 365,
            'path' => '/',
            'samesite' => 'Lax',
        ]);
        $_COOKIE['gt_voter'] = $id;
    }
    return $id;
}

function client_ip_hash() {
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
    return substr(hash('sha256', $ip . '|' . ADMIN_PASS), 0, 16);
}

function clean_text($s, $max) {
    $s = trim(preg_replace('/\s+/u', ' ', (string)$s));
    return mb_substr($s, 0, $max);
}

function public_state($data, $voter) {
    $counts = [];
    foreach ($data['gamemodes'] as $gm) $counts[$gm['id']] = 0;
    foreach ($data['votes'] as $v) {
        if (isset($counts[$v['gm']])) $counts[$v['gm']]++;
    }
    $modes = [];
    foreach ($data['gamemodes'] as $gm) {
        $modes[] = [
            'id' => $gm['id'],
            'name' => $gm['name'],
            'description' => $gm['description'] ?? '',
            'votes' => $counts[$gm['id']],
        ];
    }
    $mine = $data['votes'][$voter]['gm'] ?? null;
    if ($mine !== null && !isset($counts[$mine])) $mine = null;

    $out = [
        'open' => (bool)$data['open'],
        'round' => (int)($data['round'] ?? 1),
        'gamemodes' => $modes,
        'total' => array_sum($counts),
        'myVote' => $mine,
        'refreshSeconds' => REFRESH_SECONDS,
        'nextReset' => DAILY_RESET ? next_reset_time() : null,
        'lastWinner' => $data['lastWinner'] ?? null,
        'serverTime' => time(),
        'admin' => is_admin(),
    ];
    if (is_admin()) {
        $out['csrf'] = $_SESSION['csrf'];
        $out['user'] = ADMIN_USER;
    }
    return $out;
}

function body() {
    $raw = file_get_contents('php://input');
    $json = json_decode($raw, true);
    return is_array($json) ? $json : $_POST;
}

// ---------- routes ----------

$action = $_GET['action'] ?? 'state';
$method = $_SERVER['REQUEST_METHOD'];
$voter = voter_id();

if ($action !== 'state' && $method !== 'POST') {
    respond(['error' => 'Use POST for this action.'], 405);
}

switch ($action) {

    case 'state':
        $data = with_data(function (&$d) { return false; });
        respond(public_state($data, $voter));

    case 'vote':
        $in = body();
        $gmId = (string)($in['id'] ?? '');
        $error = null;
        $data = with_data(function (&$d) use ($gmId, $voter, &$error) {
            if (!$d['open']) { $error = 'Voting is closed right now.'; return false; }
            $ids = array_column($d['gamemodes'], 'id');
            if (!in_array($gmId, $ids, true)) { $error = 'That gamemode no longer exists.'; return false; }
            $ip = client_ip_hash();
            if (!isset($d['votes'][$voter])) {
                $fromIp = 0;
                foreach ($d['votes'] as $v) if (($v['ip'] ?? '') === $ip) $fromIp++;
                if ($fromIp >= MAX_VOTES_PER_IP) { $error = 'Too many votes from this connection.'; return false; }
            }
            $d['votes'][$voter] = ['gm' => $gmId, 'ip' => $ip, 't' => time()];
            return true;
        });
        if ($error) respond(['error' => $error] + public_state($data, $voter), 400);
        respond(public_state($data, $voter));

    case 'unvote':
        $data = with_data(function (&$d) use ($voter) {
            if (!$d['open'] || !isset($d['votes'][$voter])) return false;
            unset($d['votes'][$voter]);
            return true;
        });
        respond(public_state($data, $voter));

    case 'login':
        $in = body();
        $u = (string)($in['username'] ?? '');
        $p = (string)($in['password'] ?? '');
        usleep(300000); // slow down password guessing
        if (ADMIN_PASS === '') respond(['error' => 'Admin login is not set up. Add secret.php on the server.'], 401);
        if (hash_equals(ADMIN_USER, $u) && hash_equals(ADMIN_PASS, $p)) {
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            $data = with_data(function (&$d) { return false; });
            respond(public_state($data, $voter));
        }
        respond(['error' => 'Wrong username or password.'], 401);

    case 'logout':
        $_SESSION = [];
        session_destroy();
        respond(['ok' => true]);

    case 'add':
        require_admin();
        $in = body();
        $name = clean_text($in['name'] ?? '', 40);
        $desc = clean_text($in['description'] ?? '', 160);
        if ($name === '') respond(['error' => 'Give the gamemode a name.'], 400);
        $error = null;
        $data = with_data(function (&$d) use ($name, $desc, &$error) {
            foreach ($d['gamemodes'] as $gm) {
                if (mb_strtolower($gm['name']) === mb_strtolower($name)) { $error = 'A gamemode with that name already exists.'; return false; }
            }
            if (count($d['gamemodes']) >= 30) { $error = 'Limit of 30 gamemodes reached.'; return false; }
            $d['gamemodes'][] = ['id' => bin2hex(random_bytes(5)), 'name' => $name, 'description' => $desc];
            return true;
        });
        if ($error) respond(['error' => $error], 400);
        respond(public_state($data, $voter));

    case 'edit':
        require_admin();
        $in = body();
        $id = (string)($in['id'] ?? '');
        $name = clean_text($in['name'] ?? '', 40);
        $desc = clean_text($in['description'] ?? '', 160);
        if ($name === '') respond(['error' => 'Give the gamemode a name.'], 400);
        $data = with_data(function (&$d) use ($id, $name, $desc) {
            foreach ($d['gamemodes'] as &$gm) {
                if ($gm['id'] === $id) { $gm['name'] = $name; $gm['description'] = $desc; return true; }
            }
            return false;
        });
        respond(public_state($data, $voter));

    case 'delete':
        require_admin();
        $in = body();
        $id = (string)($in['id'] ?? '');
        $data = with_data(function (&$d) use ($id) {
            $d['gamemodes'] = array_values(array_filter($d['gamemodes'], function ($gm) use ($id) { return $gm['id'] !== $id; }));
            foreach ($d['votes'] as $k => $v) if ($v['gm'] === $id) unset($d['votes'][$k]);
            return true;
        });
        respond(public_state($data, $voter));

    case 'toggle':
        require_admin();
        $data = with_data(function (&$d) { $d['open'] = !$d['open']; return true; });
        respond(public_state($data, $voter));

    case 'reset':
        require_admin();
        $data = with_data(function (&$d) {
            $d['votes'] = [];
            $d['round'] = (int)($d['round'] ?? 1) + 1;
            $d['open'] = true;
            return true;
        });
        respond(public_state($data, $voter));

    default:
        respond(['error' => 'Unknown action.'], 404);
}
