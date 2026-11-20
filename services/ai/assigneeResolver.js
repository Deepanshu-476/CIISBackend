const mongoose = require('mongoose');
const User = require('../../models/User');
const Department = require('../../models/Department');
const { levenshtein } = require('./sttNormalizer');

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEVANAGARI_KNOWN_PHRASES = {
  'वंचटेस्ट': 'vansh test',
  'वंच टेस्ट': 'vansh test',
  'वंश टेस्ट': 'vansh test',
  'वन टेस्ट': 'vansh test',
  'टेस्ट एड्मिन': 'test admin',
  'टेस्ट एडमिन': 'test admin',
  'आरफ शर्मा': 'aarav sharma',
  'आरव शर्मा': 'aarav sharma',
  'राव शर्मा': 'aarav sharma',
  'रोमेन महता': 'rohan mehta',
  'रोहन मेहता': 'rohan mehta',
  'काव्या वंसल': 'kavya bansal',
  'काव्या बंसल': 'kavya bansal',
  'इशिता सिंग': 'ishita singh',
  'इशिता सिंह': 'ishita singh',
  'गौरब राजपूत': 'gaurav rajput',
  'गौरव राजपूत': 'gaurav rajput',
  'सिम्रन कौर': 'simran kaur',
  'सिमरन कौर': 'simran kaur',
  'पंकज भाटिया': 'pankaj bhatia',
  'पूजा अरोड़ा': 'pooja arora',
  'पूजा अरोरा': 'pooja arora',
  'दिव्या तिवारी': 'divya tiwari',
  'दीपक सेठी': 'deepak sethi',
  'राहुल खन्ना': 'rahul khanna',
  'नेहा सक्सेना': 'neha saxena',
  'कबीर मल्होत्रा': 'kabir malhotra',
  'प्रिया चौहान': 'priya chauhan',
  'आदित्य कुमार': 'aditya kumar',
  'विवान जोशी': 'vivaan joshi',
  'अनन्या गुप्ता': 'ananya gupta',
  'अर्जुन वर्मा': 'arjun verma',
  'दिया पटेल': 'diya patel',
  'दीया पटेल': 'diya patel',
};

const DEVANAGARI_CHAR_MAP = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah', 'ऑ': 'o',
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h', 'ॉ': 'o',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
  'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'ज़': 'z', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g',
  '्': ''
};

function transliterateDevanagariToLatin(text) {
  if (!text || typeof text !== 'string') return '';
  if (!/[\u0900-\u097F]/.test(text)) return text.trim();
  let str = text.trim();
  for (const [k, v] of Object.entries(DEVANAGARI_KNOWN_PHRASES)) {
    if (str.includes(k)) {
      str = str.replace(new RegExp(k, 'g'), v);
    }
  }
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    out += DEVANAGARI_CHAR_MAP[ch] !== undefined ? DEVANAGARI_CHAR_MAP[ch] : ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

function computeNameSimilarity(targetStr, candidateName) {
  const t = targetStr.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const c = candidateName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (!t || !c) return 0;
  if (t === c) return 1.0;

  // Specific phonetic homophones reported in Whisper recordings
  if (t.includes('one') && c.includes('vansh') && (t.includes('test') || c.includes('test'))) {
    return 0.96;
  }
  if (t.includes('rav') && c.includes('aarav') && (t.includes('sharma') || c.includes('sharma'))) {
    return 0.95;
  }
  if ((t.includes('ansel') && c.includes('bansal')) && (t.includes('kavya') || t.includes('kaavya'))) {
    return 0.94;
  }
  if (t.includes('pankat') && c.includes('pankaj')) {
    return 0.94;
  }
  if (t.includes('romen') && c.includes('rohan')) {
    return 0.93;
  }
  if (t.includes('gaurab') && c.includes('gaurav')) {
    return 0.95;
  }

  // Direct substring check
  if (c.includes(t) || t.includes(c)) {
    // If target is just a single short word like "test", avoid falsely overriding "Test Admin" if "Test" exists
    if (t.length <= 4 && c.length > 6) {
      return 0.85;
    }
    return 0.95;
  }

  const tWords = t.split(/\s+/).filter(Boolean);
  const cWords = c.split(/\s+/).filter(Boolean);

  let exactWordMatches = 0;
  for (const tw of tWords) {
    if (cWords.includes(tw)) exactWordMatches++;
  }

  const fullDist = levenshtein(t, c);
  const maxLen = Math.max(t.length, c.length);
  const fullSim = maxLen > 0 ? (1 - fullDist / maxLen) : 0;

  let tokenSimSum = 0;
  for (const tw of tWords) {
    let bestWordSim = 0;
    for (const cw of cWords) {
      const d = levenshtein(tw, cw);
      const m = Math.max(tw.length, cw.length);
      const sim = m > 0 ? (1 - d / m) : 0;
      if (sim > bestWordSim) bestWordSim = sim;
    }
    tokenSimSum += bestWordSim;
  }
  const tokenSim = tWords.length > 0 ? (tokenSimSum / tWords.length) : 0;

  let score = Math.max(fullSim, tokenSim);
  if (exactWordMatches >= 1 && (tWords.length > 1 || cWords.length > 1)) {
    score = Math.max(score, 0.75 + (exactWordMatches / Math.max(tWords.length, cWords.length)) * 0.2);
  }

  return score;
}

async function resolveAssignee({ name, requester }, deps = {}) {
  const UserModel = deps.User || User;
  const DeptModel = deps.Department || Department;

  const rawName = String(name || '').replace(/^[,;.\s]+|[,;.\s]+$/g, '').trim();
  if (!rawName) {
    return { status: 'none', candidates: [] };
  }

  const companyId = requester?.company?._id || requester?.company || requester?.companyId || requester?.companyCode;
  // Fail-closed: company ke bina kabhi search nahi.
  if (!companyId && !Array.isArray(deps.companyUsers)) {
    return { status: 'none', candidates: [] };
  }

  const rawCompanyCode = requester?.companyCode || requester?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  // Transliterate Devanagari to Latin phonetics
  const latinName = transliterateDevanagariToLatin(rawName) || rawName;
  const escapedName = escapeRegex(rawName);
  const escapedLatin = escapeRegex(latinName);
  const nameRegex = new RegExp('(?:^|\\s)(?:' + escapedName + '|' + escapedLatin + ')', 'i');

  const filter = {
    isActive: true,
    name: { $regex: nameRegex },
    company: companyId,
    ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
  };

  let users;
  if (Array.isArray(deps.companyUsers)) {
    users = deps.companyUsers.filter((u) => nameRegex.test(u.name));
  } else {
    users = await UserModel.find(filter)
      .select('_id name employeeId jobRole department branch')
      .limit(10)
      .lean();
  }

  let isFuzzy = false;
  // If exact regex returned 0, OR if regex matched only 1 person but input might have closer phonetic match:
  if (!users || users.length === 0) {
    let pool = [];
    if (Array.isArray(deps.companyUsers)) {
      pool = deps.companyUsers;
    } else {
      pool = await UserModel.find({
        isActive: true,
        company: companyId,
        ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
      })
        .select('_id name employeeId jobRole department branch')
        .limit(100)
        .lean();
    }

    const target = (latinName || rawName).trim().toLowerCase();
    const scoredCandidates = (pool || []).map((u) => {
      const score = computeNameSimilarity(target, u.name || '');
      return { user: u, score };
    }).filter(c => c.score >= 0.55);

    scoredCandidates.sort((a, b) => b.score - a.score);

    if (scoredCandidates.length > 0) {
      const topScore = scoredCandidates[0].score;
      if (topScore >= 0.72) {
        // High confidence match
        const closeMatches = scoredCandidates.filter(c => c.score >= 0.72 && c.score >= topScore - 0.05);
        if (closeMatches.length > 1 && topScore < 0.92) {
          users = closeMatches.map(c => c.user);
        } else {
          users = [scoredCandidates[0].user];
        }
      } else {
        // Fuzzy / ambiguous match
        users = scoredCandidates.map(c => c.user);
        isFuzzy = true;
      }
    }
  }

  if (!users || users.length === 0) {
    return { status: 'none', candidates: [] };
  }

  const deptIdsToLookup = users
    .map((u) => String(u.department || ''))
    .filter((d) => mongoose.Types.ObjectId.isValid(d));

  const deptMap = new Map();
  if (deptIdsToLookup.length > 0 && DeptModel) {
    try {
      const deptDocs = await DeptModel.find({
        _id: { $in: deptIdsToLookup },
        company: companyId,
      })
        .select('_id name departmentName')
        .lean();
      (deptDocs || []).forEach((d) => {
        deptMap.set(String(d._id), d.name || d.departmentName || '');
      });
    } catch {}
  }

  const candidates = users.map((u) => {
    let deptDisplay = String(u.department || '').trim();
    if (mongoose.Types.ObjectId.isValid(deptDisplay) && deptMap.has(deptDisplay)) {
      deptDisplay = deptMap.get(deptDisplay);
    }
    const id = String(u._id || u.id);
    const cand = {
      id,
      _id: id,
      name: u.name,
      employeeId: u.employeeId || '',
      jobRole: u.jobRole && u.jobRole !== 'user' ? u.jobRole : '',
      department: deptDisplay || 'General',
    };
    const meta = [];
    if (cand.employeeId) meta.push(cand.employeeId);
    if (cand.jobRole) meta.push(cand.jobRole);
    else if (cand.department) meta.push(cand.department);
    cand.label = meta.length > 0 ? `${cand.name} (${meta.join(', ')})` : cand.name;
    return cand;
  });

  if (isFuzzy) {
    return {
      status: 'fuzzy',
      isFuzzy: true,
      suggestedName: candidates[0].name,
      user: candidates[0],
      candidates,
    };
  }

  if (candidates.length > 1) {
    return { status: 'multiple', candidates };
  }

  return { status: 'single', user: candidates[0], candidates };
}

module.exports = {
  resolveAssignee,
  escapeRegex,
  transliterateDevanagariToLatin,
  computeNameSimilarity,
};
