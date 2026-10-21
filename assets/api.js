// Gamemode Tag — talks to the Supabase database (see supabase/setup.sql).
// gtApi(action, body) resolves to the site state (or {error}), with _ok and _status set.
(function () {
  var cfg = window.GT_SUPABASE || {};
  var configured = cfg.url && cfg.anonKey && cfg.url.indexOf('YOUR-PROJECT') === -1;
  var memory = {};

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      if (value === undefined) return memory[key] || null;
      memory[key] = value;
    }
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function voterToken() {
    var t = store('gt_voter');
    if (!t || t.length < 16) { t = randomId(); store('gt_voter', t); }
    return t;
  }

  function adminToken() { return store('gt_admin'); }

  function rpc(fn, args) {
    if (!configured) {
      return Promise.resolve({ error: 'Supabase is not connected yet. Fill in assets/supabase-config.js.', _ok: false, _status: 500 });
    }
    return fetch(cfg.url.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.anonKey
      },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
        if (r.ok) {
          data = (data && typeof data === 'object') ? data : {};
          data._ok = true;
          data._status = r.status;
          return data;
        }
        var msg = (data && data.message) || ('Server error (' + r.status + ')');
        var status = msg === 'Admin login required.' ? 403 : r.status;
        if (status === 403) store('gt_admin', null);
        return { error: msg, _ok: false, _status: status };
      });
    });
  }

  window.gtApi = function (action, body) {
    body = body || {};
    switch (action) {
      case 'state':
        return rpc('gt_state', { voter_token: voterToken(), admin_token: adminToken() });
      case 'vote':
        return rpc('gt_vote', { voter_token: voterToken(), gamemode_id: body.id });
      case 'unvote':
        return rpc('gt_unvote', { voter_token: voterToken() });
      case 'login':
        return rpc('gt_admin_login', { username: body.username, password: body.password }).then(function (d) {
          if (!d._ok) return d;
          store('gt_admin', d.token);
          return window.gtApi('state');
        });
      case 'logout':
        var tok = adminToken();
        store('gt_admin', null);
        return tok ? rpc('gt_admin_logout', { admin_token: tok }) : Promise.resolve({ _ok: true });
      case 'add':
        return rpc('gt_admin_add', { admin_token: adminToken(), name: body.name, description: body.description || '' });
      case 'edit':
        return rpc('gt_admin_edit', { admin_token: adminToken(), id: body.id, name: body.name, description: body.description || '' });
      case 'delete':
        return rpc('gt_admin_delete', { admin_token: adminToken(), id: body.id });
      case 'toggle':
        return rpc('gt_admin_toggle', { admin_token: adminToken() });
      case 'reset':
        return rpc('gt_admin_reset', { admin_token: adminToken() });
    }
    return Promise.resolve({ error: 'Unknown action', _ok: false, _status: 400 });
  };
})();
