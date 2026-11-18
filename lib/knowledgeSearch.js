// lib/knowledgeSearch.js
// Finds the passages of a user's Knowledge Base that best match a caller's
// question, using plain keyword scoring (TF × IDF over the user's own passages).
//
// This is deliberately NOT RAG: no embeddings, no vector database, no LLM call.
// It just picks text; the voice agent's own LLM turns that text into speech.
// Pure functions only (no DB, no network) so they are easy to test.

import { isPlaceholderContent } from "./knowledgeText.js";

const PASSAGE_TARGET_CHARS = 550;
const MAX_ANSWER_CHARS = 1100; // keep spoken answers short (voice latency)
const MAX_PASSAGES = 3;

const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as is are was were be been being am " +
    "do does did done have has had having i me my we our you your he she it its they them their this that " +
    "these those what which who whom whose when where why how can could would should will shall may might " +
    "must about into over under than too very just also not no yes please tell know want need get got give " +
    "let us any some there here " +
    // Conversational fillers (stemmed forms). These carry no intent, so removing
    // them keeps the matcher focused on the actual question even when people add
    // "so", "exactly", "guys", "much", etc.
    "really actually exactly much well okay ok yeah yes kinda sorta stuff thing things like kind sort type " +
    "basically literally simply quite pretty maybe mean see way lot gonna wanna gonna uh um hmm anyway guys " +
    "thank thanks hi hello hey there today now still even more most such own one two three"
  ).split(" ")
);

// Light plural stripping so "prices" matches "price". Works on any script.
function stem(t) {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text) {
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.map(stem).filter((w) => (w.length > 1 || /\p{N}/u.test(w)) && !STOPWORDS.has(w));
}

/** Split an article into ~550-char passages on sentence boundaries. */
export function splitPassages(content) {
  const sentences = String(content || "")
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const passages = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length + 1 > PASSAGE_TARGET_CHARS) {
      passages.push(buf);
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) passages.push(buf);
  return passages;
}

/**
 * @param {string} question
 * @param {Array<{title: string, content: string}>} articles  the caller's owner's active articles
 * @returns {{found: boolean, answer: string, sources: string[], skipped: number}}
 *   `skipped` = articles that had no searchable text (old placeholder content).
 */
export function searchKnowledge(question, articles) {
  const terms = [...new Set(tokenize(question))];
  const searchable = [];
  let skipped = 0;

  for (const a of articles || []) {
    if (isPlaceholderContent(a.content)) {
      skipped++;
      continue;
    }
    const titleTokens = new Set(tokenize(a.title));
    for (const text of splitPassages(a.content)) {
      const tokens = tokenize(text);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      searchable.push({ title: a.title, text, tf, titleTokens });
    }
  }

  const none = { found: false, answer: "", sources: [], skipped };
  if (!terms.length || !searchable.length) return none;

  // Document frequency of each query term across all passages.
  const N = searchable.length;
  const idf = new Map(
    terms.map((t) => {
      const df = searchable.reduce((n, p) => n + (p.tf.has(t) ? 1 : 0), 0);
      return [t, Math.log(1 + N / (1 + df))];
    })
  );

  const minMatched = Math.max(1, Math.ceil(terms.length * 0.4));
  const scored = [];
  for (const p of searchable) {
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const n = p.tf.get(t) || 0;
      if (n) {
        matched++;
        score += idf.get(t) * (1 + Math.log(n));
      }
      if (p.titleTokens.has(t)) score += idf.get(t) * 0.5;
    }
    if (matched >= minMatched) scored.push({ p, score: score * (0.5 + matched / terms.length) });
  }
  if (!scored.length) return none;

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const { p } of scored) {
    if (picked.length >= MAX_PASSAGES) break;
    if (picked.length && used + p.text.length > MAX_ANSWER_CHARS) continue;
    picked.push(p);
    used += p.text.length;
  }

  return {
    found: true,
    answer: picked.map((p) => p.text).join("\n\n").slice(0, MAX_ANSWER_CHARS + 200),
    sources: [...new Set(picked.map((p) => p.title))],
    skipped,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// Q&A-aware search
// ─────────────────────────────────────────────────────────────────────────────
// Handles manually entered Q&A entries (question + variations → answer) AND the
// existing document/website entries (passages from extracted text), using the same
// TF × IDF scoring as searchKnowledge().
//
// Returns { found, answer, sources, confidence }.
//   - For a qa match, `answer` is the stored answer (spoken verbatim by the agent).
//   - For a document/website match, `answer` is the matched passage text.
// `confidence` is a 0–1 estimate so callers can apply their own threshold.
//
// @param {string} question          the caller's spoken question
// @param {Array} articles           the owner's active articles
// @param {object} [opts]
// @param {string} [opts.language]   "en" | "hi" | "gu" | "" — same-language boost
// @param {number} [opts.minConfidence]  answers below this are treated as "not found"
export function searchKnowledgeQA(question, articles, opts = {}) {
  const { language = "", minConfidence = 0.34 } = opts;

  const terms = [...new Set(tokenize(question))];
  const none = { found: false, answer: "", sources: [], confidence: 0 };
  if (!terms.length) return none;

  // Build a flat list of passages. Each passage carries enough metadata to
  // reconstruct the right answer and a same-language boost weight.
  const passages = [];
  for (const a of articles || []) {
    if (!a || a.isActive === false) continue;
    const lang = String(a.language || "").toLowerCase();
    const langBoost = language && lang && lang === language ? 1.35 : 1;

    if (a.entryType === "qa") {
      // The searchable text is the question plus every variation. Matching
      // any of them should surface this entry's answer.
      const qText = [a.question, ...(Array.isArray(a.variations) ? a.variations : [])]
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .join(" . ");
      if (!qText || isPlaceholderContent(qText)) continue;
      const tokens = tokenize(`${a.title || ""} ${qText}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      passages.push({
        kind: "qa",
        title: a.title || a.question || "Q&A",
        text: qText,
        tf,
        titleTokens: new Set(tokenize(a.title || a.question || "")),
        answer: String(a.answer || "").trim(),
        langBoost,
      });
    } else {
      // document / website: search the extracted content in passages.
      if (isPlaceholderContent(a.content)) continue;
      const titleTokens = new Set(tokenize(a.title || ""));
      for (const text of splitPassages(a.content)) {
        const tokens = tokenize(text);
        const tf = new Map();
        for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
        passages.push({
          kind: "doc",
          title: a.title || "Document",
          text,
          tf,
          titleTokens,
          answer: text,
          langBoost,
        });
      }
    }
  }
  if (!passages.length) return none;

  // Document frequency of each query term across all passages.
  const N = passages.length;
  const df = new Map(terms.map((t) => [t, passages.reduce((n, p) => n + (p.tf.has(t) ? 1 : 0), 0)]));
  const idf = new Map(terms.map((t) => [t, Math.log(1 + N / (1 + df.get(t)))]));

  // Terms the KB actually recognises vs. ones it has never seen. An unseen
  // content word usually means the KB can't answer that part of the question.
  const presentTerms = terms.filter((t) => df.get(t) > 0);
  if (!presentTerms.length) return none;
  const absentSubstantial = terms.filter((t) => df.get(t) === 0 && t.length >= 4);

  const scored = [];
  for (const p of passages) {
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const n = p.tf.get(t) || 0;
      if (n) {
        matched++;
        score += idf.get(t) * (1 + Math.log(n));
      }
      if (p.titleTokens.has(t)) score += idf.get(t) * 0.5;
    }
    if (matched < 1) continue;

    // Coverage = how much of the RECOGNISABLE question this passage explains.
    const presentMatched = presentTerms.filter((t) => p.tf.has(t)).length;
    const coverage = (presentMatched / presentTerms.length) * p.langBoost;

    scored.push({ p, score, presentMatched, coverage, matched });
  }
  if (!scored.length) return none;

  scored.sort((a, b) => b.coverage - a.coverage || b.score - a.score);
  const best = scored[0];

  // The question mentions a real concept the KB doesn't know AND we matched
  // fewer than two recognisable terms → we'd be guessing. Decline instead.
  const intentGap = absentSubstantial.length > 0 && best.presentMatched < 2;
  if (intentGap) return none;
  // Recognise less than half the question → too weak to commit to an answer.
  if (best.coverage < 0.5) return none;

  const confidence = Math.min(1, Number(best.coverage.toFixed(3)));
  if (confidence < minConfidence) return none;

  return {
    found: true,
    answer: best.p.answer || best.p.text,
    sources: [best.p.title],
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory search  (persons + departments)
// ─────────────────────────────────────────────────────────────────────────────
// Called BEFORE the Q&A search whenever the visitor's utterance looks like they
// want to meet someone, find a department, or ask about an interview.
//
// Returns:
//   { found: false }  — no directory entry matched
//   { found: true, entry, intent, matchedName, answer }
//     entry  — the raw KnowledgeArticle lean object
//     intent — "meet_person" | "find_department" | "interview"
//     matchedName — the name token that triggered the match (for logging)
//     answer — the receptionist's reply, ready to speak

/**
 * Normalise a name for loose comparison:
 * lower-case, strip punctuation, collapse spaces.
 */
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\u0a80-\u0aff\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when `utterance` contains all tokens of `namePart` as
 * contiguous or close-proximity words (tolerates one filler word between
 * first and last name).
 */
function utteranceContainsName(utteranceLow, namePart) {
  const nTokens = normName(namePart).split(" ").filter(Boolean);
  if (!nTokens.length) return false;
  // Single-token name (e.g. "Kartik") — simple substring.
  if (nTokens.length === 1) return utteranceLow.includes(nTokens[0]);
  // Multi-token: require ALL tokens to appear in order with ≤2 words between.
  const words = utteranceLow.split(/\s+/);
  let ni = 0;
  for (let wi = 0; wi < words.length && ni < nTokens.length; wi++) {
    if (words[wi].startsWith(nTokens[ni]) || nTokens[ni].startsWith(words[wi])) ni++;
  }
  return ni === nTokens.length;
}

/** Detect "want to meet / see / speak / talk / find" intent */
function hasMeetIntent(utt) {
  return /\b(meet|see|speak|talk|find|visit|contact|get|looking for|want to meet|want to see|milna|milne|bhetu|maafi|mudva|mudvanu)\b/i.test(utt);
}
/** Detect appointment / scheduled meeting intent */
function hasAppointmentIntent(utt) {
  return /\b(appointment|scheduled|schedule|book|fix|arrange|meeting|confirm|appoint|milap|samay)\b/i.test(utt);
}
/** Detect interview / job / resume intent */
function hasInterviewIntent(utt) {
  // Note: "hr" deliberately excluded — "where is the HR department?" is a
  // location query handled by the department search, not an interview intent.
  return /\b(interview|resume|cv|job|vacancy|hire|joining|recruitment|intervu|naukri|kaam)\b/i.test(utt);
}
/** Detect "where is / which floor / direction" intent — but NOT "where should I go for my interview" */
function hasWhereIntent(utt) {
  if (hasInterviewIntent(utt)) return false; // e.g. "Where should I go for my interview?" is an interview intent
  return /\b(where|which floor|how do i reach|direction|kyaan|kahan|floor|cabin|room|office of)\b/i.test(utt);
}

/**
 * Build the receptionist's spoken answer for a person or department match.
 * Never invents info — if a field is blank it omits it gracefully.
 */
function buildDirectoryAnswer(entry, intent) {
  if (entry.directoryType === "person") {
    const name = entry.personName || entry.title;
    const desig = entry.designation ? `, ${entry.designation}` : "";
    const dept  = entry.department  ? ` from the ${entry.department} department` : "";
    const cabin = entry.cabin       ? ` Their cabin is ${entry.cabin}.` : "";
    const notes = entry.directoryNotes ? ` ${entry.directoryNotes}` : "";

    if (intent === "interview") {
      if (cabin)
        return `${name}${desig}${dept} handles interviews.${cabin}${notes} Please have a seat and I will let them know you have arrived.`;
      return `${name}${desig}${dept} handles interviews. I will inform them that you are here. Could I have your name please?`;
    }
    if (hasWhereIntent(intent === "where" ? "where" : "")) {
      return `${name}${desig}${dept}.${cabin}${notes}`;
    }
    if (cabin)
      return `${name}${desig}${dept}.${cabin}${notes} Please wait a moment and I will let ${name.split(" ")[0]} know you are here.`;
    return `${name}${desig}${dept}. I will check if ${name.split(" ")[0]} is available. Could I have your name and what it is regarding?`;
  }

  // department
  const deptName = entry.department || entry.title;
  const cabin    = entry.cabin       ? ` It is located at ${entry.cabin}.` : "";
  const notes    = entry.directoryNotes ? ` ${entry.directoryNotes}` : "";

  if (intent === "interview")
    return `For interviews and recruitment, please go to the ${deptName} department.${cabin}${notes} I will inform them you have arrived.`;
  return `The ${deptName} department is here.${cabin}${notes} I will call someone to assist you.`;
}

/**
 * Main directory search.
 *
 * @param {string} utterance       the visitor's raw spoken text
 * @param {Array}  entries         all active KnowledgeArticle lean objects for this user
 * @returns {{ found: boolean, entry?, intent?, matchedName?, answer? }}
 */
export function searchDirectory(utterance, entries) {
  const uLow = normName(utterance);
  const dirEntries = (entries || []).filter(
    (a) => a.entryType === "directory" && a.isActive !== false
  );
  if (!dirEntries.length) return { found: false };

  // ── 1. Interview intent without a named person ─────────────────────────────
  // "Where is the HR department?" should NOT trigger the interviewer path —
  // that is a location query, not a job/interview request.
  if (hasInterviewIntent(uLow) && !hasWhereIntent(uLow)) {
    // Prefer an explicitly marked interviewer, then fall back to HR dept, then HR person.
    const interviewers = dirEntries.filter(
      (e) => e.directoryType === "person" && e.isInterviewer
    );
    if (interviewers.length) {
      return {
        found: true,
        entry: interviewers[0],
        intent: "interview",
        matchedName: interviewers[0].personName || interviewers[0].title,
        answer: buildDirectoryAnswer(interviewers[0], "interview"),
      };
    }
    const hrDept = dirEntries.find(
      (e) => e.directoryType === "department" &&
        /\b(hr|human resource|recruitment|hiring)\b/i.test(e.department || e.title)
    );
    if (hrDept) {
      return {
        found: true,
        entry: hrDept,
        intent: "interview",
        matchedName: hrDept.department || hrDept.title,
        answer: buildDirectoryAnswer(hrDept, "interview"),
      };
    }
    const hrPerson = dirEntries.find(
      (e) => e.directoryType === "person" &&
        /\b(hr|human resource|recruitment)\b/i.test(e.department || e.designation || "")
    );
    if (hrPerson) {
      return {
        found: true,
        entry: hrPerson,
        intent: "interview",
        matchedName: hrPerson.personName || hrPerson.title,
        answer: buildDirectoryAnswer(hrPerson, "interview"),
      };
    }
  }

  // ── 2. Named person search ─────────────────────────────────────────────────
  // Score every person entry. The one whose most-specific name matches best wins.
  // "Most specific" = most tokens of that name found in the utterance.
  // This prevents a shared last name ("Trivedi") from routing to the wrong person.
  let bestPerson = null;
  let bestScore = 0;

  for (const e of dirEntries.filter((e) => e.directoryType === "person")) {
    const names = [
      e.personName,
      ...(e.nameAliases || []),
      // also try first-name-only and last-name-only
      ...(e.personName ? e.personName.split(" ").filter((w) => w.length > 2) : []),
    ].filter(Boolean);

    for (const n of names) {
      if (!utteranceContainsName(uLow, n)) continue;
      // Score = number of tokens in this name that matched. Longer match wins.
      const score = normName(n).split(" ").length;
      if (score > bestScore) {
        bestScore = score;
        bestPerson = e;
      }
    }
  }

  if (bestPerson) {
    // If the visitor is asking "where is the [DeptName] department?" and a department
    // entry also matches, prefer the department — the visitor wants directions, not
    // a person lookup. Only override when hasWhereIntent is signalled and
    // the matched name is a department-level alias (e.g. "HR", "Sales").
    if (hasWhereIntent(uLow)) {
      for (const e of dirEntries.filter((e) => e.directoryType === "department")) {
        const allNames = [
          normName(e.department || e.title || ""),
          ...(e.nameAliases || []).map(normName),
        ].filter(Boolean);
        if (allNames.some((n) => n && uLow.includes(n))) {
          return {
            found: true,
            entry: e,
            intent: "find_department",
            matchedName: e.department || e.title,
            answer: buildDirectoryAnswer(e, "find_department"),
          };
        }
      }
    }

    const intent = hasAppointmentIntent(uLow)
      ? "appointment"
      : hasInterviewIntent(uLow)
        ? "interview"
        : hasWhereIntent(uLow)
          ? "where"
          : hasMeetIntent(uLow)
            ? "meet_person"
            : "meet_person"; // default for "I came to see X"

    let answer;
    if (intent === "appointment") {
      const name = bestPerson.personName || bestPerson.title;
      const cabin = bestPerson.cabin ? ` ${name}'s cabin is at ${bestPerson.cabin}.` : "";
      answer = `Of course. Could I have your name please? I will check with ${name} and confirm your appointment.${cabin}`;
    } else if (intent === "where") {
      const name = bestPerson.personName || bestPerson.title;
      const cabin = bestPerson.cabin
        ? `${name}'s cabin is at ${bestPerson.cabin}.${bestPerson.directoryNotes ? " " + bestPerson.directoryNotes : ""}`
        : `Let me find out where ${name} is seated and I will guide you in a moment.`;
      answer = cabin;
    } else {
      answer = buildDirectoryAnswer(bestPerson, intent);
    }

    return {
      found: true,
      entry: bestPerson,
      intent,
      matchedName: bestPerson.personName || bestPerson.title,
      answer,
    };
  }

  // ── 3. Department search ───────────────────────────────────────────────────
  for (const e of dirEntries.filter((e) => e.directoryType === "department")) {
    const deptName = normName(e.department || e.title || "");
    // Check department name + all aliases. For multi-word aliases, also check
    // whether the FIRST word of the alias appears in the utterance (so
    // "business enquiries" matches the alias "business development").
    const allNames = [deptName, ...(e.nameAliases || []).map(normName)].filter(Boolean);
    const matched = allNames.find((n) => {
      if (!n) return false;
      if (uLow.includes(n)) return true;
      // partial: first meaningful word of a multi-word alias
      const firstWord = n.split(" ")[0];
      return firstWord.length >= 4 && uLow.includes(firstWord);
    });
    if (matched) {
      const intent = hasInterviewIntent(uLow) ? "interview" : "find_department";
      return {
        found: true,
        entry: e,
        intent,
        matchedName: e.department || e.title,
        answer: buildDirectoryAnswer(e, intent),
      };
    }
  }

  return { found: false };
}
