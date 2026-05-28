/* =========================================================================
   Songdle - game logic
   -------------------------------------------------------------------------
   What this file does TODAY:
     - Reads each guess the player types.
     - Renders a guess card with a 3x2 grid of 6 clue tiles, matching the
       hand-drawn template:
           Row 1: Album  | Genre             | Year
           Row 2: Artist | Billboard Top 100 | Length
       Song Pic and Song Name are intentionally NOT clue tiles - they
       already appear at the top of every guess card.
     - Tracks how many guesses have been used (max 10).
     - Unlocks the two hint buttons after 5 guesses.

   What this file INTENTIONALLY does NOT do yet:
     - It does not know any real songs. There is no dataset wired in.
     - The function `evaluateGuess()` returns placeholder "pending" tiles
       so the UI is testable end-to-end. When the dataset is added later,
       the only function that needs to change is `evaluateGuess()`. The
       rest of the rendering code already understands match / close /
       none / pending states.
   ========================================================================= */

/* ---------- Config ---------- */

// Maximum number of guesses the player gets per round.
const MAX_GUESSES = 10;

// How many wrong guesses before the hint buttons unlock.
const HINT_UNLOCK_AFTER = 5;

// The 6 clue tiles shown under every guess. Order = template layout:
//   Row 1: Album, Genre, Year
//   Row 2: Artist, Billboard Top 100, Length
const ATTRIBUTES = [
  { key: "album",     label: "Album"             },
  { key: "genre",     label: "Genre"             },
  { key: "year",      label: "Year"              },
  { key: "artist",    label: "Artist"            },
  { key: "billboard", label: "Billboard Top 100" },
  { key: "length",    label: "Length"            }
];

/* ---------- DOM references ---------- */

const guessForm    = document.getElementById("guess-form");
const guessInput   = document.getElementById("guess-input");
const board        = document.getElementById("board");
const guessNumberEl = document.getElementById("guess-number");
const maxGuessesEl  = document.getElementById("max-guesses");
const hintLyricBtn = document.getElementById("hint-lyric");
const hintClipBtn  = document.getElementById("hint-clip");
const hintDisplay  = document.getElementById("hint-display");

/* ---------- Game state ---------- */

let guessesMade = 0;   // number of guesses the player has submitted

maxGuessesEl.textContent = MAX_GUESSES;
guessNumberEl.textContent = guessesMade + 1;

/* =========================================================================
   evaluateGuess(guessText)
   -------------------------------------------------------------------------
   TODO: DATASET INTEGRATION POINT

   When the song dataset is uploaded, this function should:
     1. Look up `guessText` in the dataset to get its attributes.
     2. Compare each attribute to the target song's attributes.
     3. Return one result object per ATTRIBUTES entry, with:
          { key, value, status }
        where status is one of: "match" | "close" | "none".

     Suggested "close" rules (tune later):
       - year:      within 5 years         -> close
       - length:    within 30 seconds      -> close
       - billboard: within 10 chart spots  -> close
       - genre:     same parent genre      -> close
       - album/artist: substring overlap   -> close

   Until then we return every tile in "pending" state so the UI is
   visible and testable without any real data.
   ========================================================================= */
function evaluateGuess(guessText) {
  return ATTRIBUTES.map(attr => ({
    key: attr.key,
    value: "?",        // placeholder until the dataset is wired up
    status: "pending"  // styled gray in styles.css
  }));
}

/* ---------- Rendering ---------- */

// One attribute tile: label on top, value below, color = status.
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

// One full guess card: avatar + guess text + 6 clue tiles.
// The avatar/text at the top IS the "Song Pic" + "Song Name" - that is
// why we don't repeat those as clue tiles below.
function renderGuessCard(guessText, results) {
  const card = document.createElement("article");
  card.className = "guess-card";

  const head = document.createElement("div");
  head.className = "guess-card-head";

  const pic = document.createElement("div");
  pic.className = "song-pic";
  pic.textContent = "🎵"; // generic musical-note placeholder

  const text = document.createElement("div");
  text.className = "guess-text";
  text.textContent = guessText;

  head.append(pic, text);

  const grid = document.createElement("div");
  grid.className = "tile-grid";
  ATTRIBUTES.forEach((attr, i) => {
    grid.appendChild(renderTile(attr, results[i]));
  });

  card.append(head, grid);
  return card;
}

/* ---------- Event handlers ---------- */

function handleGuess(event) {
  event.preventDefault();

  const guessText = guessInput.value.trim();
  if (!guessText) return;
  if (guessesMade >= MAX_GUESSES) return;

  const results = evaluateGuess(guessText);
  board.prepend(renderGuessCard(guessText, results));

  guessesMade += 1;
  guessInput.value = "";
  updateCounter();
  maybeUnlockHints();

  if (guessesMade >= MAX_GUESSES) {
    guessInput.disabled = true;
    guessInput.placeholder = "Out of guesses!";
  }
}

// Header counter shows the *next* guess number (so it starts at "Guess 1").
function updateCounter() {
  const next = Math.min(guessesMade + 1, MAX_GUESSES);
  guessNumberEl.textContent = next;
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
  // TODO: replace with the target song's chorus lyric from the dataset.
  hintDisplay.textContent = "Chorus lyric will appear here.";
});

hintClipBtn.addEventListener("click", () => {
  if (hintClipBtn.classList.contains("locked")) return;
  // TODO: replace with a 5-second <audio> clip from the dataset.
  hintDisplay.textContent = "5-second song clip will play here.";
});

guessForm.addEventListener("submit", handleGuess);
