const { parseHinglishDateTime, parseHinglishSlots } = require('../services/ai/hinglishParser');
const { normalizeTranscript } = require('../services/ai/sttNormalizer');

const testPhrases = [
  "due date aaj shaam sadhe paanch",
  "due date aaj shaam saadhe paanch",
  "due date aaj sham sadhe paanch",
  "due date aaj sham saadhe paanch",
  "due date aaj shaam sadhe 5",
  "due date aaj shaam saadhe 5",
  "due date aaj sham sadhe 5",
  "due date aaj sham saadhe 5",
  "due date aaj shaam sadhe paanch baje",
  "due date aaj sham sadhe paanch baje",
  "due date aaj shaam sadhe 5 baje",
  "due date aaj sham sadhe 5 baje",
  "due date aaj shaam 5 30",
  "due date aaj sham 5 30",
  "due date aaj 5 30",
  "due date 5 30",
  "due date aaj shaam 5: 30",
  "due date aaj sham 5: 30",
  "due date aaj shaam 5 : 30",
  "due date aaj sham 5 : 30",
  "due date aaj shaam paanch tees",
  "due date aaj sham panch tees",
  "due date paanch tees",
  "due date paanch baje tees minute",
  "due date paanch baj kar tees minute",
  "due date 5 baj kar 30 minute",
  "due date 5 bach kar 30 minute",
  "due date 5 baaj kar 30 minute",
  "due date sham ke 5:30",
  "shaam ko 5:30",
  "5:30 shaam",
  "5:30",
  "5:30 pm",
  "5.30 pm",
  "5.30",
  "5 30 pm",
  "saadhe paanch",
  "sadhe paanch",
  "saadhe 5",
  "sadhe 5",
  "paanch tees",
  "5 30 baje",
  "5: 30 pm",
  "5 : 30 pm",
  "5 . 30 pm",
  "5:30 p.m.",
  "5.30 p.m.",
  "5 : 30 p.m."
];

let failed = 0;
let passed = 0;

for (const p of testPhrases) {
  const norm = normalizeTranscript(p);
  const dt = parseHinglishDateTime(norm);
  const timeStr = dt ? dt.split("T")[1]?.slice(0, 5) : "NULL";
  const ok = timeStr === "17:30";
  if (ok) {
    passed++;
    console.log(`PASS [${timeStr}] <- "${p}"`);
  } else {
    failed++;
    console.log(`FAIL [${timeStr}] <- "${p}" (norm: "${norm}")`);
  }
}

console.log(`\nTOTAL: Passed=${passed}, Failed=${failed}`);
