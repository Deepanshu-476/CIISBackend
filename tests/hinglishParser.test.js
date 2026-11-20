const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseHinglishSlots,
  parseHinglishDateTime,
  isSkip,
  isSkipAll,
  applyTitleFallback,
  toIstIsoString,
} = require('../services/ai/hinglishParser');

describe('Hinglish & Devanagari Parser Suite', () => {
  // Reference fixed time: 2026-10-19 06:00:00 UTC = 2026-10-19 11:30:00 IST
  const fixedNow = new Date('2026-10-19T06:00:00.000Z');

  it('1. exact failing sentence extracts title, description and tomorrow 10:00 IST', () => {
    const msg = 'Mera task create karo uska naam yah voice change ho aur uska description pipeline connection and vah cal Subah 10:00 complete ho jaega';
    const result = parseHinglishSlots(msg, fixedNow);

    assert.equal(result.title, 'Voice change');
    assert.equal(result.description, 'Pipeline connection');
    assert.ok(result.dueDateTime);
    assert.equal(result.dueDateTime, '2026-10-20T10:00:00+05:30');
  });

  it('2. relative day words and STT typo variations', () => {
    // cal subah 10:00 -> tomorrow 10:00
    const d1 = parseHinglishDateTime('cal subah 10:00', fixedNow);
    assert.equal(d1, '2026-10-20T10:00:00+05:30');

    // kal shaam 6 baje -> tomorrow 18:00
    const d2 = parseHinglishDateTime('kal shaam 6 baje', fixedNow);
    assert.equal(d2, '2026-10-20T18:00:00+05:30');

    // aaj dopahar 2 baje -> today 14:00
    const d3 = parseHinglishDateTime('aaj dopahar 2 baje', fixedNow);
    assert.equal(d3, '2026-10-19T14:00:00+05:30');

    // Devanagari "कल सुबह 10 बजे" -> tomorrow 10:00
    const d4 = parseHinglishDateTime('कल सुबह 10 बजे', fixedNow);
    assert.equal(d4, '2026-10-20T10:00:00+05:30');

    // "das baje" (bare 10) -> today 10:00
    const d5 = parseHinglishDateTime('das baje', fixedNow);
    assert.equal(d5, '2026-10-19T10:00:00+05:30');

    // parso shaam 5 baje -> +2 days 17:00
    const d6 = parseHinglishDateTime('parso shaam 5 baje', fixedNow);
    assert.equal(d6, '2026-10-21T17:00:00+05:30');
  });

  it('3. Hindi number words and fractional time', () => {
    // dedh baje -> 13:30 (afternoon)
    const d1 = parseHinglishDateTime('dedh baje', fixedNow);
    assert.equal(d1, '2026-10-19T13:30:00+05:30');

    // dhai baje -> 14:30
    const d2 = parseHinglishDateTime('dhai baje', fixedNow);
    assert.equal(d2, '2026-10-19T14:30:00+05:30');

    // saade char baje shaam -> 16:30
    const d3 = parseHinglishDateTime('saade char baje shaam', fixedNow);
    assert.equal(d3, '2026-10-19T16:30:00+05:30');
  });

  it('4. skip words (EN / Hinglish / Devanagari)', () => {
    const skips = [
      'koi nahi',
      'kuch nahi',
      'nahi',
      'nahi hai',
      'skip',
      'chhod do',
      'blank',
      'none',
      'no',
      'rehne do',
      'नहीं',
      'कोई नहीं',
      'छोड़ दो',
      'खाली',
      'रहने दो',
    ];

    skips.forEach((w) => {
      assert.equal(isSkip(w), true, `Expected "${w}" to be recognised as skip`);
    });

    assert.equal(isSkip('Prepare audit report'), false);
    assert.equal(isSkip('kal shaam 5 baje'), false);
  });

  it('5. skip all phrases (baaki sab default, bas itna hi, etc.)', () => {
    const skipAlls = [
      'baaki sab default',
      'baki sab default',
      'bas itna hi',
      'bas',
      'baaki skip',
      'बस इतना ही',
      'बाकी सब डिफ़ॉल्ट',
    ];

    skipAlls.forEach((w) => {
      assert.equal(isSkipAll(w), true, `Expected "${w}" to be recognised as skip_all`);
    });

    assert.equal(isSkipAll('koi nahi'), false);
    assert.equal(isSkipAll('submit report'), false);
  });

  it('6. title fallback cases (a)-(e)', () => {
    // (a) "Website redesign is the title" -> "Website redesign"
    const t1 = applyTitleFallback(null, 'Website redesign is the title');
    assert.equal(t1, 'Website redesign');

    // (b) "title hai GST filing" -> "GST filing"
    const t2 = applyTitleFallback(null, 'title hai GST filing');
    assert.equal(t2, 'GST filing');

    // (c) Short clean task name <= 80 chars -> used directly
    const t3 = applyTitleFallback(null, 'Fix login authentication issue');
    assert.equal(t3, 'Fix login authentication issue');

    // (d) Skip words should NOT become title
    assert.equal(applyTitleFallback(null, 'koi nahi'), null);
    assert.equal(applyTitleFallback(null, 'baaki sab default'), null);

    // (e) Pure date/time messages should NOT become title
    assert.equal(applyTitleFallback(null, 'kal subah 10 baje'), null);
    assert.equal(applyTitleFallback(null, 'tomorrow 5pm'), null);

    // (f) Pure chip labels should NOT become title
    assert.equal(applyTitleFallback(null, 'Low'), null);
    assert.equal(applyTitleFallback(null, 'Haan'), null);
  });
});
