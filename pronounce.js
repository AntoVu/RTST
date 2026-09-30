// Spanish -> English-speaker respelling with the stressed syllable in CAPS ("gracias" -> "GRAH-syahs").
// Spanish spelling is regular enough that rules beat a small LLM here.
// ponytail: ignores regional quirks (x in México, trilled initial r); add exceptions if they matter.

const RAW_VOWELS = 'aeiouáéíóúü';
const STRONG = 'aeoáéóíú';  // accented i/u break diphthongs, so they count as strong
const WEAK = 'iuü';
const isV = (c) => STRONG.includes(c) || WEAK.includes(c);
const CLUSTER = /^([pbfkG][lr]|[td]r)$/;  // consonant pairs that start a syllable together
const CONS = { C: 'ch', Y: 'y', R: 'rr', N: 'ny', G: 'g', J: 'h' };
const VOWEL = { a: 'ah', e: 'eh', i: 'ee', o: 'oh', u: 'oo' };
const OFFGLIDE = { ai: 'eye', ei: 'ay', oi: 'oy', au: 'ow', eu: 'ehoo', ou: 'oh' };
const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

// Rewrite spelling into one symbol per sound: C=ch, Y=y consonant, R=rr, N=ñ, G=hard g, J=h sound.
function normalize(w) {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i], n = w[i + 1] ?? '', front = n !== '' && 'eiéí'.includes(n);
    if (c === 'c' && n === 'h') { out += 'C'; i++; }
    else if (c === 'l' && n === 'l') { out += 'Y'; i++; }
    else if (c === 'r' && n === 'r') { out += 'R'; i++; }
    else if (c === 'ñ') out += 'N';
    else if (c === 'q') { out += 'k'; if (n === 'u') i++; }
    else if (c === 'g' && n === 'u' && w[i + 2] && 'eiéí'.includes(w[i + 2])) { out += 'G'; i++; }
    else if (c === 'g') out += front ? 'J' : 'G';
    else if (c === 'j') out += 'J';
    else if (c === 'c') out += front ? 's' : 'k';
    else if (c === 'z') out += 's';
    else if (c === 'v') out += 'b';
    else if (c === 'x') out += 'ks';
    else if (c === 'y') out += n && RAW_VOWELS.includes(n) ? 'Y' : 'i';
    else if (c !== 'h') out += c;
  }
  return out;
}

function syllabify(w) {
  const nuclei = [];
  for (let i = 0; i < w.length;) {
    if (!isV(w[i])) { i++; continue; }
    let j = i + 1;
    while (j < w.length && isV(w[j]) && !(STRONG.includes(w[j - 1]) && STRONG.includes(w[j]))) j++;
    nuclei.push([i, j]);
    i = j;
  }
  if (!nuclei.length) return [w];
  const cuts = [0];
  for (let k = 1; k < nuclei.length; k++) {
    const a = nuclei[k - 1][1], b = nuclei[k][0], cons = w.slice(a, b);
    if (cons.length <= 1) cuts.push(a);
    else if (cons.length === 2) cuts.push(CLUSTER.test(cons) ? a : a + 1);
    else if (cons.length === 3) cuts.push(CLUSTER.test(cons.slice(1)) ? a + 1 : a + 2);
    else cuts.push(b - 2);
  }
  return cuts.map((c, k) => w.slice(c, cuts[k + 1] ?? w.length));
}

function renderNucleus(v) {
  let s = plain(v), out = '';
  while (s.length > 1 && WEAK.includes(s[0])) { out += s[0] === 'i' ? 'y' : 'w'; s = s.slice(1); }
  return out + (s.length === 1 ? VOWEL[s] : OFFGLIDE[s] ?? VOWEL[s[0]] + VOWEL[s[1]]);
}

function renderSyllable(syl) {
  return syl.replace(/[aeiouáéíóúü]+/, (v) => `\u0000${renderNucleus(v)}\u0000`)
    .split('\u0000')
    .map((part, i) => (i === 1 ? part : [...part].map((c) => CONS[c] ?? c).join('')))
    .join('');
}

function pronounceWord(word) {
  const lower = word.toLowerCase();
  const syls = syllabify(normalize(lower));
  let stress = syls.findIndex((s) => /[áéíóú]/.test(s));
  if (stress < 0) stress = /[aeiouns]$/.test(plain(lower)) ? Math.max(0, syls.length - 2) : syls.length - 1;
  return syls.map((s, i) => (syls.length > 1 && i === stress ? renderSyllable(s).toUpperCase() : renderSyllable(s))).join('-');
}

function pronounce(text) {
  return text.split(/\s+/).filter(Boolean).map((tok) => {
    const m = tok.match(/^(\P{L}*)(\p{L}+)(\P{L}*)$/u);
    return m ? m[1] + pronounceWord(m[2]) + m[3] : tok;
  }).join(' ');
}

if (typeof module !== 'undefined') module.exports = { pronounce };
