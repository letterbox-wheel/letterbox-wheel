import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  getDoc,
  setDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const LAST_USER_KEY = 'letterboxd-wheel-last-user';
const MOVIES_PATH = './data/movies.json';
const COLLECTION_NAME = 'userLists';
const USERNAME_COLLECTION = 'usernames';

const state = {
  allMovies: [],
  currentUser: null,
  availableMovies: [],
  selectedMovie: null,
  spinning: false,
  currentRotation: 0,
  userWatched: [],
  firebaseReady: false,
  db: null,
  auth: null,
  firebaseUser: null,
  stateRef: null,
  unsubscribe: null,
  checklistBusy: new Set()
};

const el = {
  loginSection: document.getElementById('loginSection'),
  appSection: document.getElementById('appSection'),
  authForm: document.getElementById('authForm'),
  authUsernameInput: document.getElementById('authUsernameInput'),
  emailInput: document.getElementById('emailInput'),
  passwordInput: document.getElementById('passwordInput'),
  signUpBtn: document.getElementById('signUpBtn'),
  authStatusText: document.getElementById('authStatusText'),
  loginForm: document.getElementById('loginForm'),
  nicknameInput: document.getElementById('nicknameInput'),
  enterNicknameBtn: document.getElementById('enterNicknameBtn'),
  welcomeText: document.getElementById('welcomeText'),
  statsText: document.getElementById('statsText'),
  syncStatusText: document.getElementById('syncStatusText'),
  logoutBtn: document.getElementById('logoutBtn'),
  spinBtn: document.getElementById('spinBtn'),
  removeSelectedBtn: document.getElementById('removeSelectedBtn'),
  resultBox: document.getElementById('resultBox'),
  watchedForm: document.getElementById('watchedForm'),
  watchedTitleInput: document.getElementById('watchedTitleInput'),
  watchedNoteInput: document.getElementById('watchedNoteInput'),
  watchedList: document.getElementById('watchedList'),
  checklistSearchInput: document.getElementById('checklistSearchInput'),
  checklistList: document.getElementById('checklistList'),
  wheelCanvas: document.getElementById('wheelCanvas')
};

const ctx = el.wheelCanvas.getContext('2d');

init();

async function init() {
  bindEvents();
  drawWheel(['Loading...']);

  try {
    await loadMovies();
    initFirebase();
  } catch (error) {
    el.resultBox.textContent = `Startup error: ${error.message}`;
    disableActions();
  }
}

async function loadMovies() {
  const response = await fetch(MOVIES_PATH);
  if (!response.ok) {
    throw new Error('Cannot load movie list.');
  }
  const data = await response.json();
  state.allMovies = Array.isArray(data) ? data : [];
}

function initFirebase() {
  if (!isFirebaseConfigured()) {
    el.resultBox.textContent = 'Firebase is not configured. Fill firebase-config.js first.';
    el.authStatusText.textContent = 'Firebase config missing.';
    disableActions();
    return;
  }

  const app = initializeApp(firebaseConfig);
  state.db = getFirestore(app);
  state.auth = getAuth(app);
  state.firebaseReady = true;

  onAuthStateChanged(state.auth, async (user) => {
    state.firebaseUser = user || null;

    if (!state.firebaseUser) {
      unsubscribeUserState();
      resetSessionUI();
      return;
    }

    updateAuthUiState();

    subscribeUserState(state.firebaseUser.uid);
    const savedNickname = localStorage.getItem(LAST_USER_KEY);
    if (savedNickname && savedNickname.trim().length >= 2) {
      login(savedNickname.trim());
    } else {
      el.resultBox.textContent = 'Enter nickname to continue.';
      drawWheel(['Nickname']);
    }
  });
}

function subscribeUserState(uid) {
  unsubscribeUserState();
  state.stateRef = doc(state.db, COLLECTION_NAME, uid);
  el.syncStatusText.textContent = 'Sync: connecting...';

  state.unsubscribe = onSnapshot(
    state.stateRef,
    (snapshot) => {
      el.syncStatusText.textContent = 'Sync: connected';
      const data = snapshot.exists() ? snapshot.data() : {};
      const watched = Array.isArray(data.watched) ? data.watched : [];
      state.userWatched = watched
        .filter((item) => item && typeof item.title === 'string')
        .map((item) => ({
          title: item.title,
          note: typeof item.note === 'string' ? item.note : '',
          date: typeof item.date === 'string' ? item.date : ''
        }));

      refreshForCurrentUser();
    },
    () => {
      el.syncStatusText.textContent = 'Sync: disconnected';
      el.resultBox.textContent = 'Realtime sync failed. Check Firestore rules/config.';
    }
  );
}

function unsubscribeUserState() {
  if (typeof state.unsubscribe === 'function') {
    state.unsubscribe();
  }
  state.unsubscribe = null;
  state.stateRef = null;
}

function bindEvents() {
  el.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSignIn();
  });

  el.signUpBtn.addEventListener('click', async () => {
    await handleSignUp();
  });

  el.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const nickname = el.nicknameInput.value.trim();
    if (nickname.length < 2) {
      return;
    }
    login(nickname);
  });

  el.logoutBtn.addEventListener('click', async () => {
    state.currentUser = null;
    state.selectedMovie = null;
    localStorage.removeItem(LAST_USER_KEY);
    await signOut(state.auth);
    resetSessionUI();
  });

  el.spinBtn.addEventListener('click', spinWheel);

  el.removeSelectedBtn.addEventListener('click', async () => {
    if (!state.selectedMovie || !state.currentUser) {
      return;
    }
    await addWatchedMovie(state.selectedMovie, 'Removed after spin');
    state.selectedMovie = null;
    el.removeSelectedBtn.disabled = true;
  });

  el.watchedForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = el.watchedTitleInput.value.trim();
    const note = el.watchedNoteInput.value.trim();
    if (!title) {
      return;
    }
    await addWatchedMovie(title, note);
    el.watchedForm.reset();
  });

  el.checklistSearchInput.addEventListener('input', () => {
    renderChecklist();
  });
}

function isFirebaseConfigured() {
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  return required.every((key) => {
    const value = firebaseConfig?.[key];
    return typeof value === 'string' && value.trim() !== '' && !value.includes('YOUR_');
  });
}

function isVerifiedUser() {
  return Boolean(state.firebaseUser);
}

function updateAuthUiState() {
  if (!state.firebaseUser) {
    el.authStatusText.textContent = 'Sign in to continue.';
    return;
  }

  el.authStatusText.textContent = `Signed in: ${state.firebaseUser.email}`;
}

function resetSessionUI() {
  state.currentUser = null;
  state.selectedMovie = null;
  state.userWatched = [];
  el.loginSection.classList.remove('hidden');
  el.appSection.classList.add('hidden');
  el.nicknameInput.value = '';
  el.checklistSearchInput.value = '';
  el.checklistList.innerHTML = '';
  el.syncStatusText.textContent = 'Sync: connecting...';
  updateAuthUiState();
  el.resultBox.textContent = 'Sign in to continue.';
  drawWheel(['Sign in']);
  disableActions();
}

function disableActions() {
  el.spinBtn.disabled = true;
  el.removeSelectedBtn.disabled = true;
}

async function handleSignUp() {
  if (!state.auth) {
    return;
  }

  const username = el.authUsernameInput.value.trim();
  const email = el.emailInput.value.trim();
  const password = el.passwordInput.value;
  const usernameKey = normalizeUsername(username);

  if (!usernameKey || !email || password.length < 6) {
    el.authStatusText.textContent = 'Enter username, email, and password (min 6 chars).';
    return;
  }

  try {
    const usernameRef = doc(state.db, USERNAME_COLLECTION, usernameKey);
    const usernameSnap = await getDoc(usernameRef);
    if (usernameSnap.exists()) {
      el.authStatusText.textContent = 'Username is already taken.';
      return;
    }

    const cred = await createUserWithEmailAndPassword(state.auth, email, password);
    await setDoc(usernameRef, {
      uid: cred.user.uid,
      username,
      email: email.toLowerCase(),
      createdAt: new Date().toISOString()
    });
    el.authStatusText.textContent = 'Account created. You can now sign in.';
  } catch (error) {
    el.authStatusText.textContent = error.message || 'Could not create account.';
  }
}

async function handleSignIn() {
  if (!state.auth) {
    return;
  }

  const username = el.authUsernameInput.value.trim();
  const password = el.passwordInput.value;
  const usernameKey = normalizeUsername(username);

  if (!usernameKey || !password) {
    el.authStatusText.textContent = 'Enter username and password.';
    return;
  }

  try {
    const usernameRef = doc(state.db, USERNAME_COLLECTION, usernameKey);
    const usernameSnap = await getDoc(usernameRef);
    if (!usernameSnap.exists()) {
      el.authStatusText.textContent = 'Username not found.';
      return;
    }

    const mappedEmail = String(usernameSnap.data().email || '').trim();
    if (!mappedEmail) {
      el.authStatusText.textContent = 'Username is misconfigured. Contact admin.';
      return;
    }

    el.emailInput.value = mappedEmail;
    await signInWithEmailAndPassword(state.auth, mappedEmail, password);
    el.authStatusText.textContent = 'Signed in.';
  } catch (error) {
    el.authStatusText.textContent = error.message || 'Sign in failed.';
  }
}

function login(nickname) {
  if (!state.firebaseUser) {
    el.resultBox.textContent = 'Sign in first.';
    return;
  }

  state.currentUser = nickname;
  state.selectedMovie = null;
  localStorage.setItem(LAST_USER_KEY, nickname);

  el.welcomeText.textContent = `User: ${nickname}`;
  el.loginSection.classList.add('hidden');
  el.appSection.classList.remove('hidden');
  el.spinBtn.disabled = false;

  refreshForCurrentUser();
}

function refreshForCurrentUser() {
  if (!state.currentUser) {
    return;
  }

  const watchedSet = new Set(state.userWatched.map((item) => normalize(item.title)));
  state.availableMovies = state.allMovies.filter((title) => !watchedSet.has(normalize(title)));

  if (state.availableMovies.length === 0) {
    el.resultBox.textContent = 'No movies left in your private list.';
    drawWheel(['No movies left']);
    el.spinBtn.disabled = true;
  } else {
    drawWheel(state.availableMovies);
    el.spinBtn.disabled = false;
  }

  updateStats();
  renderWatchedList();
  renderChecklist();
}

function updateStats() {
  el.statsText.textContent = `Available: ${state.availableMovies.length} / 500 · Your removed/watched: ${state.userWatched.length}`;
}

function renderWatchedList() {
  el.watchedList.innerHTML = '';

  if (state.userWatched.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No removed movies yet.';
    el.watchedList.appendChild(li);
    return;
  }

  state.userWatched.forEach((entry) => {
    const li = document.createElement('li');

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = entry.title;

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = entry.note ? entry.note : 'No note';

    const controls = document.createElement('div');
    controls.className = 'row';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'ghost';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', async () => {
      await removeWatchedByTitle(entry.title);
    });

    controls.appendChild(restoreBtn);
    li.appendChild(title);
    li.appendChild(note);
    li.appendChild(controls);
    el.watchedList.appendChild(li);
  });
}

function getWatchedEntryByTitle(title) {
  const normalized = normalize(title);
  return state.userWatched.find((entry) => normalize(entry.title) === normalized) || null;
}

function renderChecklist() {
  if (!state.currentUser) {
    return;
  }

  const query = normalize(el.checklistSearchInput.value || '');
  const filtered = state.allMovies.filter((title) => {
    if (!query) {
      return true;
    }
    return normalize(title).includes(query);
  });

  el.checklistList.innerHTML = '';

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No movies match your search.';
    el.checklistList.appendChild(li);
    return;
  }

  filtered.forEach((title) => {
    const watchedEntry = getWatchedEntryByTitle(title);
    const li = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(watchedEntry);

    const key = normalize(title);
    if (state.checklistBusy.has(key)) {
      checkbox.disabled = true;
    }

    const body = document.createElement('div');
    const titleDiv = document.createElement('div');
    titleDiv.className = 'check-title';
    titleDiv.textContent = title;

    const meta = document.createElement('div');
    meta.className = 'check-meta';
    if (!watchedEntry) {
      meta.textContent = 'Available for your wheel';
    } else {
      meta.textContent = watchedEntry.note ? `Removed · ${watchedEntry.note}` : 'Removed';
    }

    checkbox.addEventListener('change', async () => {
      state.checklistBusy.add(key);
      renderChecklist();

      if (checkbox.checked) {
        await addWatchedMovie(title, 'Checked from checklist');
      } else if (watchedEntry) {
        await removeWatchedByTitle(watchedEntry.title);
      }

      state.checklistBusy.delete(key);
      renderChecklist();
    });

    body.appendChild(titleDiv);
    body.appendChild(meta);
    label.appendChild(checkbox);
    label.appendChild(body);
    li.appendChild(label);
    el.checklistList.appendChild(li);
  });
}

async function addWatchedMovie(title, note) {
  if (!state.firebaseReady || !state.currentUser || !isVerifiedUser() || !state.stateRef) {
    el.resultBox.textContent = 'You must be signed in.';
    return;
  }

  const normalized = normalize(title);
  const existsInMaster = state.allMovies.some((movie) => normalize(movie) === normalized);
  if (!existsInMaster) {
    el.resultBox.textContent = 'Movie not found in Top 500 list.';
    return;
  }

  const original = state.allMovies.find((movie) => normalize(movie) === normalized) || title;

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(state.stateRef);
      const current = snapshot.exists() && Array.isArray(snapshot.data().watched)
        ? snapshot.data().watched
        : [];

      const alreadyAdded = current.some((entry) => normalize(entry.title || '') === normalized);
      if (alreadyAdded) {
        throw new Error('Movie is already in your removed/watched list.');
      }

      const updated = [
        {
          title: original,
          note: note || '',
          date: new Date().toISOString()
        },
        ...current
      ];

      transaction.set(
        state.stateRef,
        {
          watched: updated,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    el.resultBox.textContent = `Removed: ${original}`;
  } catch (error) {
    el.resultBox.textContent = error.message || 'Could not update your list.';
  }
}

async function removeWatchedByTitle(title) {
  if (!state.firebaseReady || !isVerifiedUser() || !state.stateRef) {
    el.resultBox.textContent = 'You must be signed in to restore movies.';
    return;
  }

  const normalizedTitle = normalize(title);

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(state.stateRef);
      const current = snapshot.exists() && Array.isArray(snapshot.data().watched)
        ? snapshot.data().watched
        : [];

      const itemIndex = current.findIndex((entry) => normalize(entry?.title || '') === normalizedTitle);
      if (itemIndex < 0) {
        return;
      }

      const updated = current.filter((_, index) => index !== itemIndex);

      transaction.set(
        state.stateRef,
        {
          watched: updated,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    el.resultBox.textContent = 'Movie restored to your wheel.';
  } catch (error) {
    el.resultBox.textContent = error.message || 'Could not restore movie.';
  }
}

function normalize(value) {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeUsername(value) {
  const raw = String(value).trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]/g, '');
  return cleaned.length >= 3 ? cleaned : '';
}

function spinWheel() {
  if (state.spinning || state.availableMovies.length === 0 || !state.currentUser) {
    return;
  }

  state.spinning = true;
  el.spinBtn.disabled = true;
  el.removeSelectedBtn.disabled = true;

  const targetIndex = Math.floor(Math.random() * state.availableMovies.length);
  const sliceDeg = 360 / state.availableMovies.length;
  const centerAngle = targetIndex * sliceDeg + sliceDeg / 2;
  const targetAtPointer = 360 - centerAngle;
  const rounds = 6 + Math.floor(Math.random() * 3);
  state.currentRotation += rounds * 360 + targetAtPointer;

  el.wheelCanvas.style.transform = `rotate(${state.currentRotation}deg)`;

  setTimeout(() => {
    const selected = state.availableMovies[targetIndex];
    state.selectedMovie = selected;
    state.spinning = false;
    el.spinBtn.disabled = false;
    el.removeSelectedBtn.disabled = false;
    el.resultBox.textContent = `Selected: ${selected}`;
  }, 4700);
}

function drawWheel(movies) {
  const width = el.wheelCanvas.width;
  const height = el.wheelCanvas.height;
  const radius = Math.min(width, height) / 2 - 8;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);

  const count = movies.length;
  const slice = (Math.PI * 2) / count;

  for (let i = 0; i < count; i += 1) {
    const start = i * slice;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#4f6ef5' : '#7289da';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#10131a';
  ctx.fill();

  ctx.fillStyle = '#f0f2f7';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('SPIN', 0, 6);

  ctx.restore();
}
