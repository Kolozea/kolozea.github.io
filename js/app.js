/* ──────────────────────────────────────────────
   HeartSync P2P — Client Application
   ────────────────────────────────────────────── */

// ── State ──
const state = {
  username: null,
  peer: null,
  conn: null,
  partnerName: null,
  isConnected: false,
  map: null,
  userMarker: null,
  partnerMarker: null,
  watchId: null,
  _firstFix: true,
  _accuracyCircle: null,
  messages: [],
  currentTab: 'chat',
};

// ── DOM ──
const $ = id => document.getElementById(id);
let toastTimer;

// ── Toast ──
function showToast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Enter App ──
function enterApp() {
  const name = $('login-username').value.trim();
  if (!name) { showToast('Please enter a name', 'error'); return; }
  state.username = name;
  localStorage.setItem('hs_username', name);
  $('user-badge').textContent = name;
  $('auth-page').style.display = 'none';
  $('dashboard').classList.add('active');
  initPeer();
  initMap();
  startLocationTracking();
}

function logout() {
  if (state.conn) state.conn.close();
  if (state.peer) state.peer.destroy();
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  localStorage.removeItem('hs_username');
  location.reload();
}

// ── PeerJS ──
function initPeer() {
  // Generate a short human-readable peer ID based on name + random
  const saved = localStorage.getItem('hs_peerId');
  const peerId = saved || (state.username.toLowerCase().replace(/[^a-z0-9]/g,'') + '-' + Math.random().toString(36).slice(2,6));
  if (!saved) localStorage.setItem('hs_peerId', peerId);
  $('my-peer-id').textContent = peerId;

  state.peer = new Peer(peerId, {
    debug: 2,
  });

  state.peer.on('open', (id) => {
    console.log('PeerJS open:', id);
    $('my-peer-id').textContent = id;
    showToast('🟢 Ready! Share your Peer ID', 'success');
  });

  // Listen for incoming connections
  state.peer.on('connection', (conn) => {
    console.log('Incoming connection from:', conn.peer);
    handleConnection(conn);
  });

  state.peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    if (err.type === 'unavailable-id') {
      // ID taken, generate a new one
      const newId = state.username.toLowerCase().replace(/[^a-z0-9]/g,'') + '-' + Math.random().toString(36).slice(2,6);
      localStorage.setItem('hs_peerId', newId);
      showToast('ID taken, regenerated...', 'warning');
      state.peer.destroy();
      initPeer();
    } else if (err.type === 'peer-unavailable') {
      showToast('❌ Partner not found. Check the ID.', 'error');
    } else {
      showToast('⚠️ ' + err.message, 'warning');
    }
  });
}

function connectToPeer() {
  const targetId = $('peer-input').value.trim();
  if (!targetId) { showToast('Enter a Peer ID', 'error'); return; }
  if (targetId === state.peer.id) { showToast('That\'s your own ID!', 'error'); return; }

  showToast('🔗 Connecting...', 'info');
  const conn = state.peer.connect(targetId, { reliable: true });
  handleConnection(conn);
}

function handleConnection(conn) {
  state.conn = conn;

  conn.on('open', () => {
    console.log('DataChannel open with:', conn.peer);
    state.isConnected = true;

    // Send our name
    conn.send(JSON.stringify({ type: 'intro', name: state.username }));

    $('heart-icon').textContent = '💖';
    $('conn-status').textContent = 'Connected!';
    $('status-bar').textContent = `💬 Connected — chatting as ${state.username}`;
    $('status-bar').style.color = 'var(--success)';
    $('disconnect-btn').style.display = 'inline-block';
    $('peer-input').value = '';
    showToast('💖 Connected!', 'success');
  });

  conn.on('data', (data) => {
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : data;
      handleMessage(msg);
    } catch (e) {
      // Raw text
      handleMessage({ type: 'chat', text: data });
    }
  });

  conn.on('close', () => {
    state.isConnected = false;
    state.partnerName = null;
    $('heart-icon').textContent = '💔';
    $('conn-status').textContent = 'Disconnected';
    $('status-bar').textContent = '⏳ Connection lost — waiting for reconnect...';
    $('status-bar').style.color = 'var(--text-muted)';
    $('disconnect-btn').style.display = 'none';
    if (state.partnerMarker) {
      state.map.removeLayer(state.partnerMarker);
      state.partnerMarker = null;
    }
    showToast('💔 Disconnected', 'warning');
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'intro':
      state.partnerName = msg.name;
      $('heart-icon').textContent = '💖';
      $('conn-status').textContent = `Connected with ${msg.name}`;
      showToast(`💖 Connected with ${msg.name}!`, 'success');
      break;

    case 'chat':
      state.messages.unshift({
        from: msg.name || state.partnerName || 'Partner',
        content: msg.text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sent: false,
      });
      if (state.currentTab === 'chat') renderChat();
      break;

    case 'location':
      updatePartnerMarker(msg.latitude, msg.longitude);
      break;

    case 'typing':
      const el = $('typing-indicator');
      if (msg.isTyping) {
        el.textContent = `${state.partnerName || 'Partner'} is typing...`;
        el.classList.add('show');
      } else {
        el.classList.remove('show');
      }
      break;
  }
}

function sendData(data) {
  if (state.conn && state.conn.open) {
    state.conn.send(JSON.stringify(data));
  }
}

function disconnect() {
  if (state.conn) {
    state.conn.close();
  }
}

// ── Chat ──
function sendMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !state.isConnected) {
    if (!state.isConnected) showToast('Not connected to anyone', 'warning');
    return;
  }
  sendData({ type: 'chat', text });
  state.messages.unshift({
    from: state.username,
    content: text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    sent: true,
  });
  input.value = '';
  renderChat();
}

function renderChat() {
  const container = $('chat-messages');
  if (state.messages.length === 0) {
    container.innerHTML = '<div class="chat-empty">No messages yet.<br>Say something sweet! 💌</div>';
    return;
  }
  container.innerHTML = state.messages.map(m => `
    <div class="chat-msg ${m.sent ? 'sent' : 'received'}">
      <div style="font-size:0.75rem;opacity:0.7;margin-bottom:2px;">${m.sent ? 'You' : m.from}</div>
      <div>${escapeHtml(m.content)}</div>
      <div class="msg-time">${m.time}</div>
    </div>
  `).join('');
}

// ── Map ──
function initMap() {
  state.map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(state.map);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
}

function updateUserMarker(lat, lng, accuracy) {
  if (state.userMarker) {
    state.userMarker.setLatLng([lat, lng]);
  } else {
    state.userMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="dot-pulse"><div class="dot-me"></div></div>',
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      })
    }).addTo(state.map).bindPopup(`<b>${state.username}</b><br>You ❤️`);
  }
  if (state._accuracyCircle) {
    state._accuracyCircle.setLatLng([lat, lng]);
    if (accuracy) state._accuracyCircle.setRadius(accuracy);
  } else if (accuracy) {
    state._accuracyCircle = L.circle([lat, lng], { radius: accuracy, color: '#ff6b9d', fillOpacity: 0.08, weight: 1, opacity: 0.3 }).addTo(state.map);
  }
  if (state._firstFix) {
    state._firstFix = false;
    state.map.setView([lat, lng], 16);
  }
}

function updatePartnerMarker(lat, lng) {
  if (state.partnerMarker) {
    state.partnerMarker.setLatLng([lat, lng]);
  } else {
    state.partnerMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="dot-pulse" style="--dot:var(--success)"><div class="dot-partner"></div></div>',
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
    }).addTo(state.map).bindPopup(`<b>${state.partnerName || 'Partner'}</b><br>Partner 💚`);
  }
}

function centerOnMe() {
  if (state.userMarker) state.map.setView(state.userMarker.getLatLng(), 16);
}

// ── Geolocation ──
function startLocationTracking() {
  if (!navigator.geolocation) { showToast('Geolocation unavailable', 'error'); return; }
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      updateUserMarker(latitude, longitude, accuracy);
      // Send to partner
      sendData({ type: 'location', latitude, longitude });
    },
    (err) => {
      let msg = '📍 Location unavailable';
      if (err.code === 1) msg = '⚠️ Allow location in browser settings';
      else if (err.code === 2) msg = '⚠️ No GPS signal. Try outside.';
      showToast(msg, 'error');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// ── Tabs ──
function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.sidebar-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.sidebar-panel').forEach(el => el.classList.toggle('active', el.id === tab + '-panel'));
  if (tab === 'chat') renderChat();
}

// ── Helpers ──
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ── Init ──
const savedName = localStorage.getItem('hs_username');
if (savedName) {
  $('login-username').value = savedName;
}
