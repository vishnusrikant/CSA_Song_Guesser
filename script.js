/* =========================================================================
   Songdle - game logic
   -------------------------------------------------------------------------
   What this file does:
     - Loads the song dataset (data/spotify_tracks_popular.csv) on startup.
     - Picks a random secret song as the round's answer.
     - Custom autocomplete dropdown: as the player types, songs whose TITLE
       contains those letters appear, sorted by Popularity (high -> low).
       Only ~5 show at once; the list scrolls for the rest. The player must
       CLICK (or arrow-key + Enter) a suggestion before a guess can be
       submitted - free-typed text alone is not a valid guess.
     - For each guess, renders a guess card with a 3x2 grid of 6 clue tiles:
           Row 1: Album  | Genre      | Year
           Row 2: Artist | Popularity | Length
     - Tracks guesses (max 10), unlocks hint buttons after 5, and handles
       win / out-of-guesses end states.

   DATASET COLUMNS (data/spotify_tracks_popular.csv):
     track_id, artists, album_name, track_name, popularity, duration_ms,
     track_genre
   Mapping notes:
     - Year:       no release date in the dataset -> tile left blank ("-").
     - Popularity: Spotify 0-100 score, re-scaled in the CSV.
     - Hints:      no lyrics/audio in the dataset -> placeholder text.
   ========================================================================= */

/* ---------- Config ---------- */

const MAX_GUESSES = 10;          // guesses per round
const HINT_UNLOCK_AFTER = 5;     // wrong guesses before hints unlock
const DATA_URL = "data/spotify_tracks_popular.csv";

const MIN_CHARS = 3;             // start suggesting after this many letters
const MAX_RESULTS = 50;          // most-popular matches loaded into the list

// The secret answer is drawn only from well-known songs (popularity above
// this, on the rescaled 20-100 scale). Guesses may still be ANY song.
const ANSWER_MIN_POPULARITY = 50;

// "Close" thresholds (tune freely).
const POP_CLOSE = 10;            // popularity within +/-10  -> close
const LEN_MATCH_MS = 2000;       // length within 2s         -> match
const LEN_CLOSE_MS = 30000;      // length within 30s        -> close

// The 6 clue tiles, in template order:
//   Row 1: Album, Genre, Year
//   Row 2: Artist, Popularity, Length
const ATTRIBUTES = [
  { key: "album",      label: "Album"      },
  { key: "genre",      label: "Genre"      },
  { key: "year",       label: "Year"       },
  { key: "artist",     label: "Artist"     },
  { key: "popularity", label: "Popularity" },
  { key: "length",     label: "Length"     }
];

/* ---------- DOM references ---------- */

const guessForm     = document.getElementById("guess-form");
const guessInput    = document.getElementById("guess-input");
const board         = document.getElementById("board");
const guessNumberEl = document.getElementById("guess-number");
const maxGuessesEl   = document.getElementById("max-guesses");
const hintLyricBtn  = document.getElementById("hint-lyric");
const hintClipBtn   = document.getElementById("hint-clip");
const hintDisplay   = document.getElementById("hint-display");
const suggestionsEl = document.getElementById("suggestions"); // <ul> dropdown
const messageEl     = document.getElementById("message");

/* ---------- Game state ---------- */

let songs = [];          // all dataset rows (deduped by track_id)
let target = null;       // the secret song for this round
let guessesMade = 0;
let gameOver = false;

// Autocomplete state.
let currentMatches = []; // songs currently shown in the dropdown
let activeIndex = -1;    // keyboard-highlighted row (-1 = none)
let selectedSong = null; // the song the player has committed to (via click/Enter)

maxGuessesEl.textContent = MAX_GUESSES;
guessNumberEl.textContent = guessesMade + 1;

/* ---------- Boot: load dataset, then start a round ---------- */

guessInput.disabled = true;
guessInput.placeholder = "Loading songs...";

loadSongs()
  .then(startRound)
  .catch(err => {
    console.error(err);
    setMessage(
      "Could not load the song dataset. If you opened this file directly, " +
      "run a local server (e.g. `python3 -m http.server`) and reload.",
      "lose"
    );
  });

/* =========================================================================
   Dataset loading + parsing
   ========================================================================= */

async function loadSongs() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`fetch ${DATA_URL} failed: ${res.status}`);
  const rows = parseCSV(await res.text());

  const header = rows[0];
  const col = name => header.indexOf(name);
  const iId = col("track_id"), iArt = col("artists"), iAlb = col("album_name"),
        iName = col("track_name"), iPop = col("popularity"),
        iDur = col("duration_ms"), iGen = col("track_genre");

  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < header.length) continue;
    const id = row[iId];
    if (seen.has(id)) continue;        // drop per-track_id duplicates
    seen.add(id);

    songs.push({
      track_id:    id,
      artists:     row[iArt],
      album_name:  row[iAlb],
      track_name:  row[iName],
      popularity:  Number(row[iPop]),
      duration_ms: Number(row[iDur]),
      track_genre: row[iGen],
      _title:      normalize(row[iName])  // precomputed for fast filtering
    });
  }
  if (!songs.length) throw new Error("dataset parsed to 0 songs");
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, quotes,
// and \n inside quotes). Returns an array of string arrays.
function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* =========================================================================
   Round setup
   ========================================================================= */

function startRound() {
  // The answer is restricted to popular songs; guesses are not (computeMatches
  // still searches the full `songs` set).
  const answerPool = songs.filter(s => s.popularity > ANSWER_MIN_POPULARITY);
  const pool = answerPool.length ? answerPool : songs; // fallback, just in case
  target = pool[Math.floor(Math.random() * pool.length)];
  console.log("[Songdle] secret song:", target.track_name, "-", target.artists); // dev aid
  guessInput.disabled = false;
  guessInput.placeholder = "Type a song title...";
  guessInput.focus();
  setMessage(`Loaded ${songs.length.toLocaleString()} songs. Start typing a title.`);
}

/* =========================================================================
   Autocomplete dropdown
   ========================================================================= */

// Filter by title substring, sort by popularity desc, keep top MAX_RESULTS.
function computeMatches(query) {
  const q = normalize(query);
  if (q.length < MIN_CHARS) return [];
  const hits = [];
  for (const song of songs) {
    if (song._title.includes(q)) hits.push(song);
  }
  hits.sort((a, b) => b.popularity - a.popularity);
  return hits.slice(0, MAX_RESULTS);
}

function refreshSuggestions() {
  currentMatches = computeMatches(guessInput.value);
  activeIndex = -1;
  renderSuggestions();
}

function renderSuggestions() {
  suggestionsEl.innerHTML = "";
  if (!currentMatches.length) { closeSuggestions(); return; }

  currentMatches.forEach((song, i) => {
    const li = document.createElement("li");
    li.className = "suggestion" + (i === activeIndex ? " active" : "");
    li.setAttribute("role", "option");
    li.dataset.index = String(i);

    const main = document.createElement("div");
    main.className = "suggestion-main";
    const title = document.createElement("div");
    title.className = "suggestion-title";
    title.textContent = song.track_name;
    const sub = document.createElement("div");
    sub.className = "suggestion-sub";
    sub.textContent = song.artists;
    main.append(title, sub);

    const pop = document.createElement("div");
    pop.className = "suggestion-pop";
    pop.textContent = song.popularity;

    li.append(main, pop);
    suggestionsEl.appendChild(li);
  });

  suggestionsEl.classList.add("open");
}

function closeSuggestions() {
  suggestionsEl.classList.remove("open");
  suggestionsEl.innerHTML = "";
  activeIndex = -1;
}

// Commit to a song: fill the input, lock it in as the guess, close the list.
function selectSong(i) {
  const song = currentMatches[i];
  if (!song) return;
  selectedSong = song;
  guessInput.value = `${song.track_name} - ${song.artists}`;
  closeSuggestions();
  guessInput.focus();
  setMessage("Locked in. Hit Enter or the search icon to guess.");
}

function moveActive(delta) {
  if (!currentMatches.length) return;
  if (!suggestionsEl.classList.contains("open")) renderSuggestions();
  activeIndex = (activeIndex + delta + currentMatches.length) % currentMatches.length;
  renderSuggestions();
  const activeLi = suggestionsEl.children[activeIndex];
  if (activeLi) activeLi.scrollIntoView({ block: "nearest" });
}

/* =========================================================================
   evaluateGuess(song) -> one result per ATTRIBUTES entry
     result = { key, value, status }   status: match | close | none | pending
   ========================================================================= */

function evaluateGuess(song) {
  const out = {};

  out.album = {
    value: song.album_name,
    status: eq(song.album_name, target.album_name) ? "match" : "none"
  };

  out.genre = {
    value: song.track_genre,
    status: eq(song.track_genre, target.track_genre) ? "match" : "none"
  };

  // Year: no data yet -> always blank/neutral.
  out.year = { value: "-", status: "pending" };

  // Artist: exact, else "close" if they share any one artist (";"-separated).
  const a = song.artists.split(";").map(s => s.trim().toLowerCase());
  const b = target.artists.split(";").map(s => s.trim().toLowerCase());
  let artistStatus = "none";
  if (eq(song.artists, target.artists)) artistStatus = "match";
  else if (a.some(x => b.includes(x))) artistStatus = "close";
  out.artist = { value: song.artists, status: artistStatus };

  // Popularity: exact -> match, within POP_CLOSE -> close; arrow toward target.
  const pd = target.popularity - song.popularity;
  let popStatus = "none";
  if (pd === 0) popStatus = "match";
  else if (Math.abs(pd) <= POP_CLOSE) popStatus = "close";
  out.popularity = { value: `${song.popularity}${arrow(pd, popStatus)}`, status: popStatus };

  // Length: within LEN_MATCH_MS -> match, within LEN_CLOSE_MS -> close.
  const ld = target.duration_ms - song.duration_ms;
  let lenStatus = "none";
  if (Math.abs(ld) <= LEN_MATCH_MS) lenStatus = "match";
  else if (Math.abs(ld) <= LEN_CLOSE_MS) lenStatus = "close";
  out.length = { value: `${formatDuration(song.duration_ms)}${arrow(ld, lenStatus)}`, status: lenStatus };

  return ATTRIBUTES.map(attr => ({ key: attr.key, ...out[attr.key] }));
}

// Up/down hint arrow: shown when the tile is not an exact match.
function arrow(diff, status) {
  if (status === "match" || diff === 0) return "";
  return diff > 0 ? " ↑" : " ↓"; // target higher / lower
}

/* =========================================================================
   Rendering guess cards
   ========================================================================= */

function renderTile(attr, result) {
  const tile = document.createElement("div");
  tile.className = `tile ${result.status}`;

  const label = document.createElement("div");
  label.className = "tile-label";
  label.textContent = attr.label;

  const value = document.createElement("div");
  value.className = "tile-value";
  value.textContent = result.value;

  tile.append(label, value);
  return tile;
}

function renderGuessCard(song, results) {
  const card = document.createElement("article");
  card.className = "guess-card";

  const head = document.createElement("div");
  head.className = "guess-card-head";

  const pic = document.createElement("div");
  pic.className = "song-pic";
  pic.textContent = "🎵";

  const textWrap = document.createElement("div");
  const name = document.createElement("div");
  name.className = "guess-text";
  name.textContent = song.track_name;
  const sub = document.createElement("div");
  sub.className = "guess-sub";
  sub.textContent = song.artists;
  textWrap.append(name, sub);

  head.append(pic, textWrap);

  const grid = document.createElement("div");
  grid.className = "tile-grid";
  ATTRIBUTES.forEach((attr, i) => grid.appendChild(renderTile(attr, results[i])));

  card.append(head, grid);
  return card;
}

/* =========================================================================
   Guess submission + flow
   ========================================================================= */

function handleGuess(event) {
  event.preventDefault();
  if (gameOver || guessesMade >= MAX_GUESSES) return;

  // Gate: a guess is only valid once a song has been picked from the dropdown.
  if (!selectedSong) {
    setMessage("Pick a song from the dropdown first.", "lose");
    return;
  }
  const song = selectedSong;

  const results = evaluateGuess(song);
  board.prepend(renderGuessCard(song, results));

  guessesMade += 1;
  guessInput.value = "";
  selectedSong = null;
  closeSuggestions();
  updateCounter();
  maybeUnlockHints();

  if (song.track_id === target.track_id) return endGame(true);
  if (guessesMade >= MAX_GUESSES) return endGame(false);

  const left = MAX_GUESSES - guessesMade;
  setMessage(`Not it. ${left} ${left === 1 ? "guess" : "guesses"} left.`);
}

function endGame(won) {
  gameOver = true;
  guessInput.disabled = true;
  guessInput.placeholder = "Round over";
  closeSuggestions();
  if (won) {
    setMessage(`Correct! It was "${target.track_name}" by ${target.artists}.`, "win");
  } else {
    setMessage(`Out of guesses. The song was "${target.track_name}" by ${target.artists}.`, "lose");
  }
}

function updateCounter() {
  guessNumberEl.textContent = Math.min(guessesMade + 1, MAX_GUESSES);
}

function maybeUnlockHints() {
  if (guessesMade < HINT_UNLOCK_AFTER) return;
  [hintLyricBtn, hintClipBtn].forEach(btn => {
    btn.classList.remove("locked");
    btn.disabled = false;
  });
}

/* =========================================================================
   Event wiring
   ========================================================================= */

guessForm.addEventListener("submit", handleGuess);

// Typing edits the query and INVALIDATES any prior selection.
guessInput.addEventListener("input", () => {
  selectedSong = null;
  refreshSuggestions();
});

// Keyboard: arrows move the highlight, Enter picks it (then a 2nd Enter
// submits via the form), Escape closes the list.
guessInput.addEventListener("keydown", (e) => {
  // If a song is locked in, Backspace/Delete wipes the WHOLE selection at
  // once (so the player can start a fresh search) instead of nibbling one
  // character off the "Title - Artist" text.
  if ((e.key === "Backspace" || e.key === "Delete") && selectedSong) {
    e.preventDefault();
    selectedSong = null;
    guessInput.value = "";
    closeSuggestions();
    setMessage("Selection cleared - type a new search.");
    return;
  }

  const open = suggestionsEl.classList.contains("open");
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Escape") { closeSuggestions(); }
  else if (e.key === "Enter") {
    // If the list is open, Enter selects (highlighted, or the top match)
    // instead of submitting an unselected guess.
    if (open && currentMatches.length) {
      e.preventDefault();
      selectSong(activeIndex >= 0 ? activeIndex : 0);
    }
    // If the list is closed, let the form's submit handler run.
  }
});

// Click a suggestion to pick it.
suggestionsEl.addEventListener("click", (e) => {
  const li = e.target.closest(".suggestion");
  if (!li) return;
  selectSong(Number(li.dataset.index));
});

// Clicking outside the search area closes the dropdown.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) closeSuggestions();
});

hintLyricBtn.addEventListener("click", () => {
  if (hintLyricBtn.classList.contains("locked")) return;
  hintDisplay.textContent = "Lyric hints are not available in this dataset yet.";
});

hintClipBtn.addEventListener("click", () => {
  if (hintClipBtn.classList.contains("locked")) return;
  hintDisplay.textContent = "Audio clips are not available in this dataset yet.";
});

/* ---------- Small helpers ---------- */

function eq(a, b) { return normalize(a) === normalize(b); }
function normalize(s) { return (s || "").trim().toLowerCase(); }

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function setMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = "message" + (kind ? " " + kind : "");
}
