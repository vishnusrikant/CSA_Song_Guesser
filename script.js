/* =========================================================================
   Songdle - game logic
   -------------------------------------------------------------------------
   What this file does:
     - Loads the song dataset (data/spotify_tracks_popular.csv) on startup.
     - Picks a random secret song as the round's answer.
     - Offers an autocomplete of real song titles as the player types.
     - For each guess, renders a guess card with a 3x2 grid of 6 clue tiles:
           Row 1: Album  | Genre      | Year
           Row 2: Artist | Popularity | Length
       Song Pic and Song Name are NOT clue tiles - they appear at the top
       of every guess card.
     - Tracks guesses (max 10), unlocks hint buttons after 5, and handles
       win / out-of-guesses end states.

   DATASET COLUMNS (data/spotify_tracks_popular.csv):
     track_id, artists, album_name, track_name, popularity, duration_ms,
     track_genre
   Notes on the mapping to the 6 tiles:
     - Year:       the dataset has no release date, so this tile is left
                   blank ("-") in a neutral "pending" state for now.
     - Popularity: Spotify 0-100 score, already re-scaled in the CSV.
     - Hints:      the dataset has no lyrics or audio, so the two hint
                   buttons still show placeholder text - the panel is kept
                   visible intentionally.
   ========================================================================= */

/* ---------- Config ---------- */

const MAX_GUESSES = 10;          // guesses per round
const HINT_UNLOCK_AFTER = 5;     // wrong guesses before hints unlock
const DATA_URL = "data/spotify_tracks_popular.csv";
const MAX_SUGGESTIONS = 25;      // autocomplete entries shown at once

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
const songList      = document.getElementById("song-list");   // <datalist>
const messageEl     = document.getElementById("message");

/* ---------- Game state ---------- */

let songs = [];          // all dataset rows (deduped by track_id)
let labelToSong = new Map(); // "Title - Artist"            -> song
let nameToSong  = new Map(); // normalized track_name        -> song (first)
let target = null;       // the secret song for this round
let guessesMade = 0;
let gameOver = false;

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
  const text = await res.text();
  const rows = parseCSV(text);

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

    const song = {
      track_id:   id,
      artists:    row[iArt],
      album_name: row[iAlb],
      track_name: row[iName],
      popularity: Number(row[iPop]),
      duration_ms: Number(row[iDur]),
      track_genre: row[iGen]
    };
    songs.push(song);

    const label = `${song.track_name} - ${song.artists}`;
    labelToSong.set(label, song);
    const norm = normalize(song.track_name);
    if (!nameToSong.has(norm)) nameToSong.set(norm, song);
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
  target = songs[Math.floor(Math.random() * songs.length)];
  console.log("[Songdle] secret song:", target.track_name, "-", target.artists); // dev aid
  guessInput.disabled = false;
  guessInput.placeholder = "Type a song title...";
  guessInput.focus();
  setMessage(`Loaded ${songs.length.toLocaleString()} songs. Make your first guess!`);
}

/* =========================================================================
   evaluateGuess(song) -> one result per ATTRIBUTES entry
     result = { key, value, status }   status: match | close | none | pending
   ========================================================================= */

function evaluateGuess(song) {
  const out = {};

  // Album: exact (case-insensitive).
  out.album = {
    value: song.album_name,
    status: eq(song.album_name, target.album_name) ? "match" : "none"
  };

  // Genre: same bucket.
  out.genre = {
    value: song.track_genre,
    status: eq(song.track_genre, target.track_genre) ? "match" : "none"
  };

  // Year: no data yet -> always blank/neutral.
  out.year = { value: "-", status: "pending" };

  // Artist: exact string match, else "close" if they share any one artist
  // (the column is a ";"-separated credit list).
  const a = song.artists.split(";").map(s => s.trim().toLowerCase());
  const b = target.artists.split(";").map(s => s.trim().toLowerCase());
  let artistStatus = "none";
  if (eq(song.artists, target.artists)) artistStatus = "match";
  else if (a.some(x => b.includes(x))) artistStatus = "close";
  out.artist = { value: song.artists, status: artistStatus };

  // Popularity: exact -> match, within POP_CLOSE -> close, with an arrow
  // pointing toward the target.
  const pd = target.popularity - song.popularity;
  let popStatus = "none";
  if (pd === 0) popStatus = "match";
  else if (Math.abs(pd) <= POP_CLOSE) popStatus = "close";
  out.popularity = {
    value: `${song.popularity}${arrow(pd, popStatus)}`,
    status: popStatus
  };

  // Length: within LEN_MATCH_MS -> match, within LEN_CLOSE_MS -> close.
  const ld = target.duration_ms - song.duration_ms;
  let lenStatus = "none";
  if (Math.abs(ld) <= LEN_MATCH_MS) lenStatus = "match";
  else if (Math.abs(ld) <= LEN_CLOSE_MS) lenStatus = "close";
  out.length = {
    value: `${formatDuration(song.duration_ms)}${arrow(ld, lenStatus)}`,
    status: lenStatus
  };

  // Return aligned to ATTRIBUTES order.
  return ATTRIBUTES.map(attr => ({ key: attr.key, ...out[attr.key] }));
}

// Up/down hint arrow: shown when the tile is not an exact match.
function arrow(diff, status) {
  if (status === "match" || diff === 0) return "";
  return diff > 0 ? " ↑" : " ↓"; // target higher / lower
}

/* =========================================================================
   Guess resolution (typed text -> a real dataset song)
   ========================================================================= */

function resolveGuess(text) {
  const raw = text.trim();
  if (!raw) return null;
  if (labelToSong.has(raw)) return labelToSong.get(raw);   // picked from list
  return nameToSong.get(normalize(raw)) || null;           // typed a title
}

// Rebuild the autocomplete <datalist> with up to MAX_SUGGESTIONS matches.
function refreshSuggestions() {
  const q = normalize(guessInput.value);
  songList.innerHTML = "";
  if (q.length < 2) return;
  let n = 0;
  for (const [label, song] of labelToSong) {
    if (normalize(song.track_name).includes(q) ||
        normalize(song.artists).includes(q)) {
      const opt = document.createElement("option");
      opt.value = label;
      songList.appendChild(opt);
      if (++n >= MAX_SUGGESTIONS) break;
    }
  }
}

/* =========================================================================
   Rendering
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
  pic.textContent = "🎵"; // musical note

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
   Event handlers + flow
   ========================================================================= */

function handleGuess(event) {
  event.preventDefault();
  if (gameOver || guessesMade >= MAX_GUESSES) return;

  const song = resolveGuess(guessInput.value);
  if (!song) {
    setMessage("No song by that name in the list - pick one from the suggestions.", "lose");
    return;
  }

  const results = evaluateGuess(song);
  board.prepend(renderGuessCard(song, results));

  guessesMade += 1;
  guessInput.value = "";
  songList.innerHTML = "";
  updateCounter();
  maybeUnlockHints();

  if (song.track_id === target.track_id) return endGame(true);
  if (guessesMade >= MAX_GUESSES) return endGame(false);

  setMessage(`Not it. ${MAX_GUESSES - guessesMade} ${guessesMade === MAX_GUESSES - 1 ? "guess" : "guesses"} left.`);
}

function endGame(won) {
  gameOver = true;
  guessInput.disabled = true;
  guessInput.placeholder = "Round over";
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

hintLyricBtn.addEventListener("click", () => {
  if (hintLyricBtn.classList.contains("locked")) return;
  // No lyrics in the dataset yet - placeholder.
  hintDisplay.textContent = "Lyric hints are not available in this dataset yet.";
});

hintClipBtn.addEventListener("click", () => {
  if (hintClipBtn.classList.contains("locked")) return;
  // No audio in the dataset yet - placeholder.
  hintDisplay.textContent = "Audio clips are not available in this dataset yet.";
});

guessForm.addEventListener("submit", handleGuess);
guessInput.addEventListener("input", refreshSuggestions);

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
