// Verify a generated .adofai / direction sequence against the project's own timing.
// Replicates Player.ts tile-scheduling math (initSchedules) using the adofai parser.
//
// Usage:
//   node verify-timing.mjs <angleDataJson> [countdownTicks] [bpm]
// prints, for each tile index, its arrival time in beats.
function resolveAngleOffset(v) {
  if (v === 555) return 72;
  if (v === 666) return -72;
  if (v === 777) return 52;
  if (v === 888) return -52;
  return null;
}
function normalizeAngle(v) { return ((v % 360) + 360) % 360; }

// Same parse as adofai lib levelAngle.parseAngle (no twirl events -> isTwirl 0)
function parseAngle(agd, i, angleDir) {
  let prev = 0;
  if (i === 0) angleDir.value = 180;
  const offset = resolveAngleOffset(agd[i]);
  if (offset !== null) {
    const prevDir = normalizeAngle(angleDir.value - 180);
    const actualDir = normalizeAngle(prevDir + offset);
    const delta = normalizeAngle(angleDir.value - actualDir);
    prev = delta; if (prev === 0) prev = 360;
    angleDir.value = normalizeAngle(actualDir + 180);
  } else if (agd[i] === 999) {
    let minus = 1;
    while (i - minus >= 0 && agd[i - minus] === 999) minus++;
    const realAngle = i - minus >= 0 ? agd[i - minus] : 0;
    angleDir.value = normalizeAngle(realAngle + (minus - 1) * 180);
    if (isNaN(angleDir.value)) angleDir.value = 0;
    prev = 0;
  } else {
    const delta = normalizeAngle(angleDir.value - agd[i]);
    prev = delta; if (prev === 0) prev = 360;
    angleDir.value = normalizeAngle(agd[i] + 180);
  }
  return prev;
}

function tileAngles(angleData) {
  const ad = angleData.map(Number);
  const ang = new Array(ad.length);
  const angleDir = { value: 180 };
  for (let i = 0; i < ad.length; i++) ang[i] = parseAngle(ad, i, angleDir);
  return ang;
}

// arrival time in BEATS of each tile. Mirrors Player.ts initSchedules duration math:
// duration_i = (|totalAngle_i|/(2pi))*2 * (60/bpm); totalAngle uses tile.angle (deg->rad),
// tile0 special (countdown arc), midspin (direction 999) zero.
function arrivalBeats(angleData, countdownTicks, bpm) {
  const angles = tileAngles(angleData);
  const ad = angleData.map(Number);
  const n = ad.length;
  const spb = 60 / bpm; // seconds per beat
  const start = new Array(n).fill(0); // arrival seconds of tile i (index)
  let isCW = true; // no twirl events in generated charts
  for (let i = 0; i < n - 1; i++) {
    const pivotAngle = angles[i];
    let totalAngleDeg;
    if (i === 0) {
      const movedDeg = ((180 + pivotAngle) % 360 + 360) % 360;
      totalAngleDeg = (countdownTicks - 1) * 180 + movedDeg;
    } else if (ad[i] === 999) {
      totalAngleDeg = 0; // midspin: instant
    } else {
      totalAngleDeg = pivotAngle;
    }
    let totalAngleRad = (totalAngleDeg * Math.PI) / 180;
    if (isCW) totalAngleRad = -totalAngleRad;
    const rotationAmount = Math.abs(totalAngleRad) / (2 * Math.PI);
    const duration = rotationAmount * 2 * spb;
    start[i + 1] = start[i] + duration;
  }
  return start.map((s) => s / spb); // convert seconds -> beats
}

const [,, angleJson, countdownArg, bpmArg] = process.argv;
if (!angleJson) { console.error('usage: node verify-timing.mjs <angleData.json> [countdown] [bpm]'); process.exit(1); }
const angleData = JSON.parse(angleJson);
const countdownTicks = countdownArg ? Number(countdownArg) : 4;
const bpm = bpmArg ? Number(bpmArg) : 100;
const beats = arrivalBeats(angleData, countdownTicks, bpm);
console.log('countdownTicks=', countdownTicks, 'bpm=', bpm, 'tiles=', angleData.length);
console.log('tile angles:', JSON.stringify(tileAngles(angleData)));
console.log('arrival beats:', JSON.stringify(beats.map((x) => Math.round(x * 1000) / 1000)));
