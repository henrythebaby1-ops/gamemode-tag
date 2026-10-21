// Gamemode Tag — vote page
(function () {
  var state = null;
  var period = 60;           // seconds between refreshes (server can override)
  var clockOffset = 0;       // server time - local time, in seconds
  var nextAt = 0;            // local timestamp (s) of next refresh
  var busy = false;
  var RING = 2 * Math.PI * 9;

  var $ = function (id) { return document.getElementById(id); };
  var modesEl = $('modes');
  var ring = $('ringProg');
  ring.style.strokeDasharray = RING;

  var api = window.gtApi;

  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function scheduleNext() {
    // Line up refreshes with the server clock so every player updates at the same moment.
    var serverNow = Date.now() / 1000 + clockOffset;
    var next = Math.ceil((serverNow + 0.5) / period) * period;
    nextAt = next - clockOffset;
  }

  function renderAuth() {
    var admin = !!(state && state.admin);
    $('signedOut').hidden = admin;
    $('signedIn').hidden = !admin;
    $('whoName').textContent = admin ? state.user : '';
  }

  function renderReset() {
    var pill = $('resetPill');
    if (!state || !state.nextReset) { pill.hidden = true; return; }
    var left = Math.max(0, Math.round(state.nextReset - (Date.now() / 1000 + clockOffset)));
    var h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
    pill.hidden = false;
    pill.textContent = 'Resets in ' + (h ? h + 'h ' : '') + m + 'm';
  }

  function render() {
    if (!state) return;
    renderAuth();
    var open = state.open;
    $('openPill').className = 'pill ' + (open ? 'open' : 'closed');
    $('openText').textContent = open ? 'Voting open' : 'Voting closed';
    $('roundPill').textContent = 'Round ' + state.round;
    $('totalPill').textContent = state.total + (state.total === 1 ? ' vote' : ' votes');
    renderReset();

    var w = state.lastWinner;
    $('winner').hidden = !w;
    if (w) $('winner').innerHTML = '🏆 Yesterday\'s winner: <b>' + esc(w.name) + '</b> (' + w.votes + (w.votes === 1 ? ' vote' : ' votes') + ')';

    if (!state.gamemodes.length) {
      modesEl.innerHTML = '<div class="empty">No gamemodes yet. Check back soon!</div>';
      return;
    }

    var max = 0;
    state.gamemodes.forEach(function (g) { if (g.votes > max) max = g.votes; });
    var leaders = state.gamemodes.filter(function (g) { return max > 0 && g.votes === max; });

    var html = state.gamemodes.map(function (g) {
      var pct = state.total ? Math.round((g.votes / state.total) * 100) : 0;
      var mine = state.myVote === g.id;
      var leading = leaders.length === 1 && leaders[0].id === g.id;
      var tied = leaders.length > 1 && g.votes === max;
      return '<article class="mode' + (mine ? ' mine' : '') + (leading ? ' leading' : '') + '" data-id="' + esc(g.id) + '">' +
        '<h2 class="mode-name">' + esc(g.name) +
          (leading ? ' <span class="lead">Leading</span>' : '') +
          (tied ? ' <span class="lead" style="background:var(--ink);color:var(--bg)">Tied</span>' : '') +
        '</h2>' +
        (g.description ? '<p class="mode-desc">' + esc(g.description) + '</p>' : '<p class="mode-desc"></p>') +
        '<button class="vote-btn' + (mine ? ' voted' : '') + '" type="button" data-vote="' + esc(g.id) + '"' +
          (!open ? ' disabled' : '') + '>' + (mine ? '✓ Voted' : 'Vote') + '</button>' +
        '<div class="mode-meter"><div class="bar"><span style="width:' + pct + '%"></span></div>' +
          '<span class="count tabular"><b>' + pct + '%</b> · ' + g.votes + '</span></div>' +
      '</article>';
    }).join('');
    modesEl.innerHTML = html;
  }

  function apply(data) {
    if (data && data.gamemodes) {
      state = data;
      if (data.refreshSeconds) period = Math.max(10, data.refreshSeconds);
      if (data.serverTime) clockOffset = data.serverTime - Date.now() / 1000;
      render();
    }
  }

  function refresh() {
    return api('state').then(function (d) {
      if (!d._ok) { toast(d.error || 'Server error', true); return; }
      apply(d);
    }).catch(function () {
      toast('Could not reach the server. Retrying next minute.', true);
    }).then(scheduleNext);
  }

  modesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-vote]');
    if (!btn || busy || !state || !state.open) return;
    var id = btn.getAttribute('data-vote');
    var undo = state.myVote === id;
    busy = true;
    btn.disabled = true;
    api(undo ? 'unvote' : 'vote', { id: id }).then(function (d) {
      apply(d);
      if (!d._ok) { toast(d.error || 'Vote failed', true); refresh(); }
      else toast(undo ? 'Vote removed' : 'Vote counted!');
    }).catch(function () {
      toast('Network error — try again.', true);
    }).then(function () { busy = false; render(); });
  });

  $('refreshBtn').addEventListener('click', refresh);

  // ---------- log in / log out ----------
  var dialog = $('loginDialog');
  $('loginOpen').addEventListener('click', function () {
    $('loginError').textContent = '';
    dialog.showModal();
    $('username').focus();
  });
  $('loginClose').addEventListener('click', function () { dialog.close(); });

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginError').textContent = '';
    var btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    api('login', { username: $('username').value.trim(), password: $('password').value }).then(function (d) {
      if (!d._ok) { $('loginError').textContent = d.error || 'Login failed'; return; }
      $('password').value = '';
      dialog.close();
      apply(d);
      toast('Logged in — open the Admin panel at the top');
    }).catch(function () {
      $('loginError').textContent = 'Could not reach the server.';
    }).then(function () { btn.disabled = false; });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('logout', {}).then(function () {
      if (state) state.admin = false;
      renderAuth();
      toast('Logged out');
    });
  });

  function tick() {
    var left = Math.max(0, nextAt - Date.now() / 1000);
    var s = Math.ceil(left);
    $('countdown').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    ring.style.strokeDashoffset = RING * (1 - left / period);
    renderReset();
    if (left <= 0 && nextAt) { nextAt = 0; refresh(); }
  }

  // Refresh right away when someone comes back to the tab.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  refresh();
  setInterval(tick, 250);
})();
