/*
 * Glass Swing — Accelerometer-driven virtual glass breaking
 * Uses DeviceMotion API + Web Audio API for low-latency playback
 */

// ===== CONFIG =====
const SWING_THRESHOLD = 22;        // m/s² above this = swing detected
const SWING_COOLDOWN = 1500;       // ms between swings
const IMPACT_BRIGHTNESS = 0.6;     // screen flash intensity
const CRACK_FADE_TIME = 800;       // ms before crack overlay fades
const ACCEL_SMOOTHING = 0.15;      // EMA filter for noise reduction

// ===== STATE =====
let state = {
  enabled: false,
  lastSwing: 0,
  totalShatters: 0,
  accelHistory: [],
  smoothedAccel: { x: 0, y: 0, z: 0 },
  lastMagnitude: 0,
  peakDelta: 0,
  waitingReset: false
};

// ===== DOM =====
const el = {
  loading: document.getElementById('loading-screen'),
  main: document.getElementById('main-display'),
  glassPane: document.getElementById('glass-pane'),
  glassCrack: document.getElementById('glass-crack'),
  permissionBtn: document.getElementById('permission-btn'),
  status: document.getElementById('status'),
  hint: document.querySelector('.hint'),
  shatter: document.getElementById('shatter-screen'),
  shatterOverlay: document.getElementById('shatter-overlay'),
  sounds: [
    document.getElementById('glass-sound-1'),
    document.getElementById('glass-sound-2'),
    document.getElementById('glass-sound-3')
  ]
};

// ===== AUDIO =====
let audioContext = null;
let audioBuffers = [];

function initAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    loadSounds();
  } catch (e) {
    console.warn('Web Audio API not available, falling back to HTML5 Audio');
    // Use HTML5 audio elements as fallback
    audioBuffers = el.sounds.map(s => s);
  }
}

async function loadSounds() {
  const soundFiles = [
    'glass-break-window.wav',
    'glass-break-rock.wav',
    'glass-break-glass_break.wav'
  ];

  try {
    for (const file of soundFiles) {
      const resp = await fetch(file);
      const arrayBuf = await resp.arrayBuffer();
      if (audioContext) {
        const audioBuf = await audioContext.decodeAudioData(arrayBuf);
        audioBuffers.push(audioBuf);
      }
    }
  } catch (e) {
    console.error('Failed to load sounds:', e);
    // Fallback to HTML5 audio
    audioBuffers = el.sounds;
    el.sounds.forEach(s => s.load());
  }
}

function playSound(soundIndex = 0) {
  if (audioContext && audioBuffers.length > 0) {
    // Web Audio API path — lowest latency
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffers[soundIndex];
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.8 + Math.random() * 0.2;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0);
  } else {
    // HTML5 Audio fallback
    const sound = el.sounds[soundIndex];
    sound.volume = 0.8 + Math.random() * 0.2;
    sound.currentTime = 0;
    sound.play().catch(e => console.warn('Audio play failed:', e));
  }
}

// ===== ACCELEROMETER =====
function requestPermission() {
  // iOS 13+ requires explicit permission for motion
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          startAccelerometer();
        } else {
          updateStatus('Permission denied. Try again.', true);
        }
      })
      .catch(err => {
        console.error('Permission error:', err);
        updateStatus('Error requesting permission. Try Chrome browser.', true);
      });
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    // Android Chrome, desktop — start directly
    startAccelerometer();
  } else {
    updateStatus('Motion sensor not available. Try Chrome on Android.', true);
  }
}

function startAccelerometer() {
  if (typeof DeviceMotionEvent === 'undefined') {
    updateStatus('DeviceMotion not supported on this browser. Use Chrome on Android.', true);
    return;
  }

  // On Android, we can listen directly
  window.addEventListener('devicemotion', handleMotion, { passive: true });

  state.enabled = true;
  updateStatus('Swing detection active! 🎯', false);
  el.hint.textContent = 'Swing your phone like a baseball bat';
  el.glassPane.classList.add('pulse');
  el.permissionBtn.style.display = 'none';

  setTimeout(() => {
    el.glassPane.classList.remove('pulse');
  }, 3000);

  // Warn if no motion events received (likely HTTPS requirement)
  setTimeout(() => {
    if (state.accelHistory.length === 0 && state.enabled) {
      const isLocalHttp = location.protocol === 'http:' &&
        (location.hostname === 'localhost' || location.hostname.match(/^(\d+\.){3}\d+$/));
      if (!isLocalHttp) {
        updateStatus('No motion detected. Chrome requires HTTPS for sensors on non-localhost.', true);
      } else {
        updateStatus('No motion yet. Try actually moving your phone.', false);
      }
    }
  }, 3000);
}

function handleMotion(event) {
  if (!state.enabled) return;

  const accel = event.accelerationIncludingGravity || event.acceleration;
  if (!accel) return;

  // Smooth with exponential moving average
  const a = state.smoothedAccel;
  a.x = ACCEL_SMOOTHING * accel.x + (1 - ACCEL_SMOOTHING) * a.x;
  a.y = ACCEL_SMOOTHING * accel.y + (1 - ACCEL_SMOOTHING) * a.y;
  a.z = ACCEL_SMOOTHING * accel.z + (1 - ACCEL_SMOOTHING) * a.z;

  // Magnitude of acceleration (including gravity ~9.8)
  const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

  // Detect sudden change (swing = rapid acceleration spike)
  const delta = Math.abs(magnitude - state.lastMagnitude);
  state.lastMagnitude = magnitude;
  state.peakDelta = Math.max(state.peakDelta, delta);

  // Track if we're building up to a peak
  state.accelHistory.push({
    t: Date.now(),
    mag: magnitude,
    delta: delta
  });

  // Keep only recent history
  const now = Date.now();
  state.accelHistory = state.accelHistory.filter(h => now - h.t < 300);

  // Swing detection: high delta means sudden acceleration change
  if (delta > SWING_THRESHOLD && now - state.lastSwing > SWING_COOLDOWN) {
    // Check if magnitude is in a reasonable range (not just gravity)
    const recentMotion = state.accelHistory.slice(-5);
    const avgDelta = recentMotion.reduce((s, h) => s + h.delta, 0) / recentMotion.length;

    if (avgDelta > SWING_THRESHOLD * 0.6 || delta > SWING_THRESHOLD * 1.5) {
      triggerShatter();
    }
  }
}

// ===== SHATTER EFFECT =====
function triggerShatter() {
  const now = Date.now();
  state.lastSwing = now;
  state.totalShatters++;

  // Flash the screen
  el.shatterOverlay.style.animation = 'none';
  void el.shatterOverlay.offsetWidth; // trigger reflow
  el.shatterOverlay.style.animation = 'flash 0.5s ease-out';

  // Show crack on glass
  el.glassCrack.classList.add('active');
  el.glassCrack.style.opacity = IMPACT_BRIGHTNESS;

  // Shake the glass pane
  el.glassPane.style.transition = 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)';
  el.glassPane.style.transform = 'rotateX(5deg) scale(1.05) rotate(3deg)';
  setTimeout(() => {
    el.glassPane.style.transform = 'rotateX(5deg) scale(1)';
  }, 150);

  // Play a random sound variant
  const soundIdx = Math.floor(Math.random() * audioBuffers.length);
  playSound(soundIdx);

  // Show shatter screen after a tiny delay
  setTimeout(() => {
    el.main.classList.add('hidden');
    el.shatter.classList.remove('hidden');
  }, 100);

  // Update status
  updateStatus(`💥 Shattered! (${state.totalShatters} total)`, false);
}

function resetGlass() {
  // Reset all visual state
  el.glassCrack.classList.remove('active');
  el.glassCrack.style.opacity = '0';
  el.shatter.classList.add('hidden');
  el.main.classList.remove('hidden');
  el.glassPane.style.transform = '';
  el.glassPane.style.transition = '';

  // Reset accelerometer tracking
  state.accelHistory = [];
  state.smoothedAccel = { x: 0, y: 0, z: 0 };
  state.lastMagnitude = 0;
  state.peakDelta = 0;
  state.lastSwing = 0;

  updateStatus('Ready. Swing your phone!', false);
  el.hint.textContent = 'Swing your phone like a baseball bat';
}

// ===== HELPERS =====
function updateStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

// ===== SERVICE WORKER =====
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('SW registered:', reg.scope))
        .catch((err) => console.warn('SW registration failed:', err));
    });
  }
}

// ===== INIT =====
window.addEventListener('load', () => {
  // Preload audio
  initAudio();

  // Check for PWA install prompt
  if (window.matchMedia('(display-mode: standalone)').matches) {
    document.body.classList.add('pwa-installed');
  }

  // Check for DeviceMotion support
  if (typeof DeviceMotionEvent !== 'undefined') {
    el.permissionBtn.textContent = 'Tap to Enable Swing Detection';
    el.permissionBtn.onclick = requestPermission;
  } else {
    el.permissionBtn.textContent = 'DeviceMotion not supported';
    el.permissionBtn.disabled = true;
    updateStatus('Your browser does not support the DeviceMotion API. Use Chrome on Android.', true);
  }

  // Hide loading screen after a moment
  setTimeout(() => {
    el.loading.style.opacity = '0';
    setTimeout(() => {
      el.loading.classList.add('hidden');
      el.main.classList.remove('hidden');
    }, 500);
  }, 1200);

  // Expose reset for debugging
  window.resetGlass = resetGlass;

  // Register service worker for offline support
  registerServiceWorker();
});

// Handle visibility change — keep state in sync
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause if app is backgrounded
    state.enabled = false;
    window.removeEventListener('devicemotion', handleMotion);
  }
});
