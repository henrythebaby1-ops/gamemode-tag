// Gamemode Tag — admin panel
(function () {
  var state = null;
  var editing = null;

  var $ = function (id) { return document.getElementById(id); };

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

  function showLogin() {
    $('loginPanel').hidden = false;
    $('dash').hidden = true;
  }

  function apply(d) {
    if (d._status === 403) { showLogin(); toast(d.error || 'Please log in', true); return false; }
    if (!d.gamemodes) return false;
    state = d;
    if (!d.admin) { showLogin(); return true; }
    $('loginPanel').hidden = true;
    $('dash').hidden = false;
    render();
    return true;
  }

  function render() {
    $('openPill').className = 'pill ' + (state.open ? 'open' : 'closed');
    $('openText').textContent = state.open ? 'Voting open' : 'Voting closed';
    $('roundPill').textContent = 'Round ' + state.round;
    $('totalPill').textContent = state.total + (state.total === 1 ? ' vote' : ' votes');
    $('toggleBtn').textContent = state.open ? 'Close voting' : 'Open voting';

    var list = $('adminList');
    if (!state.gamemodes.length) {
      list.innerHTML = '<p class="muted">No gamemodes yet — add one above.</p>';
      return;
    }
    list.innerHTML = state.gamemodes.map(function (g) {
      var isEditing = editing === g.id;
      return '<div class="admin-item" data-id="' + esc(g.id) + '">' +
        '<div class="meta"><strong>' + esc(g.name) + '</strong>' +
          '<small>' + (g.description ? esc(g.description) : '<i>No description</i>') + '</small>' +
          '<small class="tabular">' + g.votes + (g.votes === 1 ? ' vote' : ' votes') + '</small></div>' +
        '<div class="row">' +
          '<button class="btn ghost small" data-act="edit" type="button">' + (isEditing ? 'Cancel' : 'Edit') + '</button>' +
          '<button class="btn danger small" data-act="delete" type="button">Delete</button>' +
        '</div>' +
        (isEditing ?
          '<form class="edit-form" data-act="save">' +
            '<div class="field"><label>Name</label><input name="name" maxlength="40" required value="' + esc(g.name) + '"></div>' +
            '<div class="field"><label>Description</label><textarea name="description" maxlength="160">' + esc(g.description) + '</textarea></div>' +
            '<button class="btn small" type="submit">Save</button>' +
          '</form>' : '') +
      '</div>';
    }).join('');
  }

  function load() {
    return api('state').then(apply).catch(function () { toast('Could not reach the server', true); });
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginError').textContent = '';
    api('login', { username: $('username').value.trim(), password: $('password').value }).then(function (d) {
      if (!d._ok) { $('loginError').textContent = d.error || 'Login failed'; return; }
      $('password').value = '';
      apply(d);
      toast('Welcome, ' + $('username').value.trim() + '!');
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('logout', {}).then(function () { showLogin(); });
  });

  $('toggleBtn').addEventListener('click', function () {
    api('toggle', {}).then(function (d) {
      if (apply(d)) toast(state.open ? 'Voting is open' : 'Voting is closed');
    });
  });

  $('resetBtn').addEventListener('click', function () {
    if (!confirm('Clear all votes and start a new round?')) return;
    api('reset', {}).then(function (d) {
      if (apply(d)) toast('Round ' + state.round + ' started');
    });
  });

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('addError').textContent = '';
    api('add', { name: $('gmName').value, description: $('gmDesc').value }).then(function (d) {
      if (!d._ok && d._status !== 403) { $('addError').textContent = d.error || 'Could not add'; return; }
      if (apply(d)) {
        toast('Added “' + $('gmName').value.trim() + '”');
        $('addForm').reset();
      }
    });
  });

  $('adminList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.closest('.admin-item').getAttribute('data-id');
    var gm = state.gamemodes.find(function (g) { return g.id === id; });
    if (btn.getAttribute('data-act') === 'edit') {
      editing = editing === id ? null : id;
      render();
    } else if (btn.getAttribute('data-act') === 'delete') {
      if (!confirm('Delete “' + gm.name + '”? Its votes will be removed too.')) return;
      api('delete', { id: id }).then(function (d) { if (apply(d)) toast('Deleted'); });
    }
  });

  $('adminList').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var id = form.closest('.admin-item').getAttribute('data-id');
    api('edit', { id: id, name: form.elements['name'].value, description: form.elements['description'].value }).then(function (d) {
      if (!d._ok && d._status !== 403) { toast(d.error || 'Could not save', true); return; }
      editing = null;
      if (apply(d)) toast('Saved');
    });
  });

  // Keep vote counts fresh while the admin page is open.
  setInterval(function () { if (!editing && !$('dash').hidden) load(); }, 60000);

  load();
})();
