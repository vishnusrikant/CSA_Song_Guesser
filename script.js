// Songdle - foundational game logic (placeholder song list)

const SONGS = [
  { title: "Bohemian Rhapsody", clue: "A 1975 rock opera by Queen." },
  { title: "Hey Jude", clue: "A 1968 Beatles ballad with a famous 'na-na-na' outro." },
  { title: "Billie Jean", clue: "A 1982 Michael Jackson hit with an iconic bassline." }
];

const startButton = document.getElementById("start-button");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const guessButton = document.getElementById("guess-button");
const clueEl = document.getElementById("clue");
const resultEl = document.getElementById("result");

let currentSong = null;

function normalize(str) {
  return str.trim().toLowerCase();
}

function startGame() {
  currentSong = SONGS[Math.floor(Math.random() * SONGS.length)];
  clueEl.textContent = currentSong.clue;
  resultEl.textContent = "";
  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;
  startButton.textContent = "New Song";
  guessInput.focus();
}

function handleGuess(event) {
  event.preventDefault();
  if (!currentSong) return;

  const guess = normalize(guessInput.value);
  if (!guess) return;

  if (guess === normalize(currentSong.title)) {
    resultEl.textContent = `Correct! The song was "${currentSong.title}".`;
    guessInput.disabled = true;
    guessButton.disabled = true;
  } else {
    resultEl.textContent = "Not quite. Try again!";
  }
}

startButton.addEventListener("click", startGame);
guessForm.addEventListener("submit", handleGuess);
