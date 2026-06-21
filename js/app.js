/* ──────────────────────────────────────────────
   HeartSync P2P — Client Application
   ────────────────────────────────────────────── */

// ── State ──
const state = {
  username: null,
  peer: null,
  conn: null,
  partnerName: null,
  partnerPeerId: null,
  isConnected: false,
  map: null,
  userMarker: null,
  partnerMarker: null,
  watchId: null,
  _firstFix: true,
  _accuracyCircle: null,
  _connTimer: null,
  messages: [],
  currentTab: 'chat',
};

const $ = id => document.getElementById(id);
let toastTimer;

function showToast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function setStatus(text, color) {
  const bar = $('status-bar');
  bar.textContent = text;
  bar.style.color = color || 'var(--text-muted)';
  bar.classList.add('show');
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
  cleanupConnection();
  if (state.peer) state.peer.destroy();
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  localStorage.removeItem('hs_username');
  location.reload();
}

// ── PeerJS ──
function initPeer() {
  // Always generate a fresh ID per session
  // Never cache in localStorage — two tabs in same browser would conflict
  const base = state.username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const peerId = base + '-' + Math.random().toString(36).slice(2, 6);

  $('my-peer-id').textContent = peerId + ' (connecting to server...)';

  state.peer = new Peer(peerId, {
    debug: 2,
    config: {
      iceServers: [
        { urls: 'stun:stun.qq.com' },
        { urls: 'stun:stun.miwifi.com' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
  });

  let opened = false;

  state.peer.on('open', (id) => {
    opened = true;
    console.log('PeerJS ready:', id);
    $('my-peer-id').textContent = id;
    setStatus('🟢 Ready! Share your Peer ID above', 'var(--success)');
    showToast('🟢 Ready! Peer ID: ' + id, 'success');
  });

  state.peer.on('connection', (conn) => {
    console.log('Incoming from:', conn.peer);
    setStatus(`📩 Incoming connection from ${conn.peer}...`, 'var(--warning)');
    handleConnection(conn);
  });

  state.peer.on('error', (err) => {
    console.error('Peer error:', err.type, err.message);
    if (err.type === 'unavailable-id') {
      // ID taken, auto-regenerate
      const newId = state.username.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
      localStorage.setItem('hs_peerId', newId);
      state.peer.destroy();
      initPeer();
    } else if (err.type === 'peer-unavailable') {
      showToast('❌ Partner not found — is their page open?', 'error');
      setStatus('❌ Partner offline', 'var(--danger)');
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      showToast('⚠️ Cannot reach PeerJS server. Check internet or try again.', 'error');
      setStatus('⚠️ PeerJS server unreachable', 'var(--danger)');
    } else {
      showToast('⚠️ ' + err.message, 'warning');
    }
  });

  // If peer doesn't open within 10s, show a hint
  setTimeout(() => {
    if (!opened) {
      setStatus('⏳ Still connecting to PeerJS server...', 'var(--warning)');
      showToast('⏳ Connecting to PeerJS signaling server...', 'warning');
    }
  }, 10000);
}

/** Copy Peer ID to clipboard */
function copyPeerId() {
  const id = $('my-peer-id').textContent;
  if (!id || id.includes('connecting')) return;
  navigator.clipboard.writeText(id).then(() => {
    showToast('📋 Peer ID copied!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = id;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('📋 Peer ID copied!', 'success');
  });
}

/** Generate a fresh Peer ID (clicking "New ID" button) */
function regenerateId() {
  if (state.conn && state.conn.open) {
    if (!confirm('Disconnect current connection and get a new ID?')) return;
    cleanupConnection();
    updateUI_disconnected();
  }
  if (state.peer) state.peer.destroy();
  initPeer();
}

function connectToPeer() {
  const targetId = $('peer-input').value.trim();
  if (!targetId) { showToast('Enter a Peer ID', 'error'); return; }
  if (targetId === (state.peer.id || '')) { showToast("That's your own ID!", 'error'); return; }

  // Save partner's peer ID
  state.partnerPeerId = targetId;

  // Cancel any existing connection attempt
  if (state._connTimer) clearTimeout(state._connTimer);
  if (state.conn && !state.conn.open) {
    try { state.conn.close(); } catch(e) {}
  }

  setStatus(`🔗 Connecting to ${targetId}...`, 'var(--warning)');
  showToast('🔗 Connecting...', 'info');

  const conn = state.peer.connect(targetId);
  handleConnection(conn);

  // Connection timeout: 20 seconds
  state._connTimer = setTimeout(() => {
    if (!state.isConnected && state.conn === conn && !conn.open) {
      setStatus('❌ Connection timed out', 'var(--danger)');
      showToast('❌ Connection timed out. Check the ID or try again.', 'error');
      try { conn.close(); } catch(e) {}
      if (state.conn === conn) state.conn = null;
    }
  }, 20000);
}

function handleConnection(conn) {
  // Don't replace an active connection
  if (state.conn && state.conn.open && state.isConnected) return;

  state.conn = conn;

  conn.on('open', () => {
    if (state._connTimer) clearTimeout(state._connTimer);
    state.isConnected = true;

    // Introduce ourselves
    conn.send(JSON.stringify({
      type: 'intro',
      name: state.username,
      peerId: state.peer.id,
    }));

    updateUI_connected();
    showToast('💖 Connected!', 'success');
  });

  conn.on('data', (data) => {
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : data;
      handleMessage(msg, conn);
    } catch (e) {
      handleMessage({ type: 'chat', text: String(data) }, conn);
    }
  });

  conn.on('error', (err) => {
    console.error('Connection error:', err);
    showToast('⚠️ Connection error: ' + (err.message || 'unknown'), 'error');
  });

  conn.on('close', () => {
    state.isConnected = false;
    updateUI_disconnected();
    showToast('💔 Partner disconnected', 'warning');
  });
}

function handleMessage(msg, conn) {
  switch (msg.type) {
    case 'intro':
      state.partnerName = msg.name;
      state.partnerPeerId = msg.peerId;
      if (!state.isConnected) {
        // We received intro before our own open fired — mark as connected
        state.isConnected = true;
        if (state._connTimer) clearTimeout(state._connTimer);
        updateUI_connected();
      }
      // Reply with our intro if we haven't yet
      if (conn && conn.open) {
        conn.send(JSON.stringify({
          type: 'intro',
          name: state.username,
          peerId: state.peer.id,
        }));
      }
      updateUI_partnerInfo();
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

// ── UI Updates ──
function updateUI_connected() {
  setStatus(`💬 Connected${state.partnerName ? ' with ' + state.partnerName : '...'}`, 'var(--success)');
  $('heart-icon').textContent = '💖';
  $('conn-status').textContent = state.partnerName ? `Connected with ${state.partnerName}` : 'Connected!';
  $('disconnect-btn').style.display = 'inline-block';
  $('peer-input').value = '';
}

function updateUI_partnerInfo() {
  $('heart-icon').textContent = '💖';
  $('conn-status').textContent = `Connected with ${state.partnerName}`;
  setStatus(`💬 Connected with ${state.partnerName}`, 'var(--success)');
}

function updateUI_disconnected() {
  state.partnerName = null;
  $('heart-icon').textContent = '💔';
  $('conn-status').textContent = 'Disconnected';
  $('disconnect-btn').style.display = 'none';
  setStatus('💔 Disconnected — waiting for reconnect...', 'var(--danger)');
  if (state.partnerMarker) {
    state.map.removeLayer(state.partnerMarker);
    state.partnerMarker = null;
  }
}

function sendData(data) {
  if (state.conn && state.conn.open) {
    state.conn.send(JSON.stringify(data));
  }
}

function disconnect() {
  cleanupConnection();
  updateUI_disconnected();
}

function cleanupConnection() {
  if (state._connTimer) clearTimeout(state._connTimer);
  if (state.conn) {
    try { state.conn.close(); } catch(e) {}
    state.conn = null;
  }
  state.isConnected = false;
}

// ── Chat ──
function sendMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!state.isConnected) {
    showToast('Not connected to anyone', 'warning');
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
      <div style="font-size:0.75rem;opacity:0.7;margin-bottom:2px;">${m.sent ? 'You' : escapeHtml(m.from)}</div>
      <div>${escapeHtml(m.content)}</div>
      <div class="msg-time">${m.time}</div>
    </div>
  `).join('');
}

// ── Map ──
function initMap() {
  state.map = L.map('map', { center: [20, 0], zoom: 2, zoomControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM & CARTO', subdomains: 'abcd', maxZoom: 19,
  }).addTo(state.map);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 500);
}

function updateUserMarker(lat, lng, accuracy) {
  if (state.userMarker) {
    state.userMarker.setLatLng([lat, lng]);
  } else {
    state.userMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="dot-pulse"><div class="dot-me"></div></div>',
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
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
        html: '<div class="dot-pulse dot-pulse-green"><div class="dot-partner"></div></div>',
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
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

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ── Init ──
const savedName = localStorage.getItem('hs_username');
if (savedName) $('login-username').value = savedName;
