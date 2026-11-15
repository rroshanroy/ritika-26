const CANDLE_COUNT = 26;

// Tune this while testing. Digital microphone levels use dBFS, so values are
// negative: -24 is harder to trigger than -32, while -38 is easier.
const BLOW_THRESHOLD_DB = -30;
const BLOW_DURATION_MS = 140;
const BLOW_COOLDOWN_MS = 850;
const EXTINGUISH_CHANCE = 0.5;

const candleField = document.querySelector("#candleField");
const candleCountDisplay = document.querySelector("#candleCount");
const cake = document.querySelector("#cake");
const micButton = document.querySelector("#micButton");
const resetButton = document.querySelector("#resetButton");
const micPanel = document.querySelector("#micPanel");
const micStatus = document.querySelector("#micStatus");
const statusDot = document.querySelector("#statusDot");
const meterFill = document.querySelector("#meterFill");
const attemptMessage = document.querySelector("#attemptMessage");
const instruction = document.querySelector("#instruction");
const cakeScene = document.querySelector(".cake-scene");
const cakeCard = document.querySelector("#cakeCard");
const unboxStage = document.querySelector("#unboxStage");
const openButton = document.querySelector("#openButton");
const outroPage = document.querySelector("#outroPage");
const introPage = document.querySelector("#introPage");
const introFrames = [...document.querySelectorAll(".intro-frame")];
const introNextButton = document.querySelector("#introNextButton");
const welcomePage = document.querySelector("#welcomePage");
const welcomeNextButton = document.querySelector("#welcomeNextButton");
const spotifyDock = document.querySelector(".spotify-dock");
const spotifyToggle = document.querySelector("#spotifyToggle");

let candles = [];
let audioContext;
let analyser;
let microphoneStream;
let animationFrame;
let thresholdStartedAt = null;
let cooldownUntil = 0;
let blowAttempts = 0;
let outroShown = false;
let introFrameIndex = 0;

function candlePositions(count) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    return {
      x: 50 + Math.cos(angle) * 45,
      y: 55 + Math.sin(angle) * 40,
    };
  });
}

function createCandles() {
  candleField.replaceChildren();
  candles = candlePositions(CANDLE_COUNT).map(({ x, y }, index) => {
    const candle = document.createElement("div");
    candle.className = "candle";
    candle.style.setProperty("--x", `${x}%`);
    candle.style.setProperty("--y", `${y}%`);
    candle.style.setProperty("--delay", `${(index % 7) * -0.11}s`);
    candle.style.setProperty("--hue", `${335 + (index % 4) * 8}`);
    candle.style.zIndex = Math.round(y);
    candle.innerHTML = '<span class="wick"></span><span class="flame"></span>';
    candleField.append(candle);
    return candle;
  });

  blowAttempts = 0;
  outroShown = false;
  attemptMessage.textContent = "";
  instruction.textContent =
    "turn on ur mic, make a wish, and blow at the candles";
  cake.classList.remove("all-out");
  updateCandleCount();
}

function updateCandleCount() {
  const remaining = candles.filter(
    (candle) => !candle.classList.contains("out"),
  ).length;

  candleCountDisplay.textContent = remaining;
  cake.setAttribute(
    "aria-label",
    `Birthday cake with ${remaining} ${remaining === 1 ? "lit candle" : "lit candles"}`,
  );

  if (remaining === 0) {
    cake.classList.add("all-out");
    instruction.textContent = "";
    attemptMessage.textContent = `it took ${blowAttempts} ${
      blowAttempts === 1 ? "try" : "tries"
    }`;
    window.setTimeout(showOutro, 1000);
  }

  return remaining;
}

function showOutro() {
  if (outroShown) return;
  outroShown = true;
  cakeCard.classList.add("leaving");

  window.setTimeout(() => {
    cancelAnimationFrame(animationFrame);
    microphoneStream?.getTracks().forEach((track) => track.stop());
    audioContext?.close();
    cakeCard.hidden = true;
    outroPage.hidden = false;
    requestAnimationFrame(() => outroPage.classList.add("visible"));
  }, 650);
}

function registerBlow() {
  const litCandles = candles.filter(
    (candle) => !candle.classList.contains("out"),
  );

  if (!litCandles.length) return;

  blowAttempts += 1;
  let extinguished = 0;

  litCandles.forEach((candle) => {
    if (Math.random() < EXTINGUISH_CHANCE) {
      candle.classList.add("out");
      extinguished += 1;
    }
  });

  const remaining = updateCandleCount();
  if (remaining > 0) {
    attemptMessage.textContent = `${remaining} more`;
  }
}

function volumeToMeter(db) {
  const min = -60;
  const max = -10;
  return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
}

function readMicrophone(now) {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);

  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / samples.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;

  meterFill.style.width = `${volumeToMeter(db)}%`;
  const aboveThreshold = db > BLOW_THRESHOLD_DB;
  const coolingDown = now < cooldownUntil;

  statusDot.classList.toggle("strong", aboveThreshold && !coolingDown);

  if (aboveThreshold && !coolingDown) {
    if (thresholdStartedAt === null) thresholdStartedAt = now;

    if (now - thresholdStartedAt >= BLOW_DURATION_MS) {
      registerBlow();
      cooldownUntil = now + BLOW_COOLDOWN_MS;
      thresholdStartedAt = null;
    }
  } else {
    thresholdStartedAt = null;
  }

  animationFrame = requestAnimationFrame(readMicrophone);
}

async function enableMicrophone() {
  micButton.disabled = true;
  micButton.textContent = "Requesting microphone…";

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;

    const source = audioContext.createMediaStreamSource(microphoneStream);
    source.connect(analyser);

    micPanel.hidden = false;
    micButton.hidden = true;
    micStatus.textContent = "Listening… blow toward your microphone";
    animationFrame = requestAnimationFrame(readMicrophone);
  } catch (error) {
    micButton.disabled = false;
    micButton.textContent = "Try microphone again";
    micPanel.hidden = false;
    statusDot.classList.add("error");
    micStatus.textContent =
      "Microphone access failed. Check your browser permission and try again.";
    console.error(error);
  }
}

micButton.addEventListener("click", enableMicrophone);
resetButton.addEventListener("click", createCandles);
spotifyToggle.addEventListener("click", () => {
  const expanded = spotifyDock.classList.toggle("expanded");
  spotifyToggle.setAttribute("aria-expanded", String(expanded));
  spotifyToggle.setAttribute(
    "aria-label",
    expanded ? "Close Spotify player" : "Open Spotify player",
  );
});

welcomeNextButton.addEventListener("click", () => {
  welcomePage.classList.add("leaving");
  const fadeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 50
    : 450;

  window.setTimeout(() => {
    welcomePage.hidden = true;
    introPage.hidden = false;
    requestAnimationFrame(() => introPage.classList.add("visible"));
    introNextButton.focus();
  }, fadeDuration);
});

introNextButton.addEventListener("click", () => {
  if (introFrameIndex < introFrames.length - 1) {
    introFrames[introFrameIndex].classList.remove("active");
    introFrameIndex += 1;
    introFrames[introFrameIndex].classList.add("active");
    return;
  }

  introNextButton.disabled = true;
  introPage.classList.add("leaving");
  const fadeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 50
    : 550;

  window.setTimeout(() => {
    introPage.hidden = true;
    unboxStage.hidden = false;
    unboxStage.classList.add("entering");
    openButton.focus();
  }, fadeDuration);
});

openButton.addEventListener("click", () => {
  openButton.disabled = true;
  cakeScene.classList.add("opening");

  const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 100
    : 1500;

  window.setTimeout(() => {
    unboxStage.hidden = true;
    cakeCard.classList.remove("wrapped");
    cakeScene.classList.remove("opening");
    cakeScene.classList.add("revealed");
    micButton.focus();
  }, revealDelay);
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrame);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();
});

createCandles();
