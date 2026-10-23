const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const targetWav = path.join(fixturesDir, 'speech_sample.wav');

// Use PowerShell SpeechSynthesizer to generate real spoken speech locally
const psCommand = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('${targetWav.replace(/\\/g, '\\\\')}')
$synth.Speak('Task name Voice Assistant')
$synth.Dispose()
`;

const res = spawnSync('powershell', ['-NoProfile', '-Command', psCommand], { encoding: 'utf8' });
if (res.error || res.status !== 0) {
  console.error('PS error:', res.stderr || res.error);
} else {
  console.log('Successfully generated fixture:', targetWav, 'Size:', fs.statSync(targetWav).size, 'bytes');
}
