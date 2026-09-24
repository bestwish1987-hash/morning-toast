/* one-man-band 核心
 *
 * 簡譜文字 → 解析 → 自動配和弦 → 依曲風編曲 → 瀏覽器播放 / MIDI / WAV
 *
 * 同一份檔案同時給 Node（build.js）和瀏覽器（player.html）使用，沒有任何相依套件。
 * Node 端只用到 parseSong / harmonize / arrange / toMidi；
 * Synth / renderWav 只在瀏覽器（有 AudioContext）才會被呼叫。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Band = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────── 基本音樂常數 ─────────────────────────
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb 習慣用降記號拼

  const mod12 = (n) => ((n % 12) + 12) % 12;
  const pcName = (pc, flat) => (flat ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
  const accOf = (s) => (s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ───────────────────────── 調性 ─────────────────────────
  // 接受：C、G、Bb、F#、Am、1=C、1=G、C大調、A小調、C major、a minor
  // 小調在簡譜裡習慣用 6 當主音（1= 關係大調），所以 Am 的「1」是 C。
  function parseKey(raw) {
    let s = String(raw == null ? 'C' : raw).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    s = s.replace(/^1\s*=\s*/, '');
    const m = s.match(/^([A-Ga-g])(#|b)?\s*(m(?:in(?:or)?)?|小調|大調|maj(?:or)?)?\.?$/i);
    if (!m) return null;
    const pc = mod12(LETTER_PC[m[1].toUpperCase()] + accOf(m[2] || ''));
    const q = (m[3] || '').toLowerCase();
    const minor = q === 'm' || q === 'min' || q === 'minor' || q === '小調';
    const tonicPc = minor ? mod12(pc + 3) : pc;
    const flat = FLAT_KEYS.has(tonicPc);
    return { name: pcName(pc, flat) + (minor ? 'm' : ''), mode: minor ? 'minor' : 'major', tonicPc, rootPc: pc, flat };
  }

  function keyName(key, transpose) {
    const t = transpose || 0;
    const tonic = mod12(key.tonicPc + t);
    const flat = FLAT_KEYS.has(tonic);
    return pcName(key.rootPc + t, flat) + (key.mode === 'minor' ? 'm' : '');
  }

  // ───────────────────────── 和弦記號 ─────────────────────────
  const QUALITIES = [
    ['maj7', [0, 4, 7, 11]], ['maj9', [0, 4, 7, 11, 14]], ['m7b5', [0, 3, 6, 10]],
    ['dim7', [0, 3, 6, 9]], ['dim', [0, 3, 6]], ['m7', [0, 3, 7, 10]], ['m9', [0, 3, 7, 10, 14]],
    ['m6', [0, 3, 7, 9]], ['madd9', [0, 3, 7, 14]], ['m', [0, 3, 7]], ['7sus4', [0, 5, 7, 10]],
    ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['aug', [0, 4, 8]], ['9', [0, 4, 7, 10, 14]],
    ['7', [0, 4, 7, 10]], ['6', [0, 4, 7, 9]], ['add9', [0, 4, 7, 14]], ['5', [0, 7]], ['', [0, 4, 7]],
  ];

  function parseChord(sym) {
    if (!sym) return null;
    const s = String(sym).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    const m = s.match(/^([A-G])(#|b)?([^/\s]*)(?:\/([A-G])(#|b)?)?$/);
    if (!m) return null;
    const root = mod12(LETTER_PC[m[1]] + accOf(m[2] || ''));
    let q = (m[3] || '')
      .replace(/^(M7|Maj7|Δ7?|△7?)$/, 'maj7').replace(/^min/, 'm').replace(/^-/, 'm')
      .replace(/^(°|o)/, 'dim').replace(/^\+$/, 'aug').replace(/^M$/, '');
    let ivs = null;
    for (const [name, iv] of QUALITIES) if (q === name) { ivs = iv; break; }
    if (!ivs) { // 不認識的寫法：至少分出大小三和弦，有 7 就加七音
      ivs = /^m(?!aj)/.test(q) ? [0, 3, 7] : [0, 4, 7];
      if (/7/.test(q)) ivs = ivs.concat(/maj/.test(q) ? 11 : 10);
    }
    const bass = m[4] ? mod12(LETTER_PC[m[4]] + accOf(m[5] || '')) : root;
    return {
      symbol: s, root, bass, intervals: ivs,
      pcs: ivs.map((i) => mod12(root + i)),
      minor: ivs[1] === 3,
    };
  }

  // ───────────────────────── 簡譜解析 ─────────────────────────
  const HEADER_KEYS = {
    title: ['曲名', '歌名', '標題', 'title', 'name', 'song'],
    key: ['調', '調性', '調號', 'key'],
    meter: ['拍', '拍號', '拍子', 'time', 'meter'],
    tempo: ['速度', 'tempo', 'bpm'],
    style: ['曲風', '風格', 'style'],
    chords: ['和弦', '和絃', 'chords', 'chord'],
    lead: ['主奏', '主奏樂器', '旋律樂器', '旋律', 'lead', 'melody'],
    lyrics: ['詞', '歌詞', 'lyrics', 'lyric'],
  };

  // 一個小節裡的記號：[和弦]、音符（升降 + 數字 + 高低八度 + 附點/底線）、延長線 -、空白、括號、其他
  const TOKEN_RE = /\[([^\]]+)\]|([#b♯♭]?)([0-7])([',’^]*)(\.?)(_*)(\.?)|(-|—|–)|(\s+)|([()~,])|(.)/g;

  function parseSong(text) {
    const song = {
      title: '', key: parseKey('C'), meter: { num: 4, den: 4 }, tempo: null, style: null, lead: null,
      bars: [], warnings: [], totalBeats: 0, source: String(text || ''),
    };
    const headerChords = [];
    const lyricParts = [];
    const noteLines = [];

    for (const rawLine of song.source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^(#|\/\/)/.test(line)) continue;
      const hm = line.match(/^([^\s:：|[\]]{1,12})\s*[:：]\s*(.*)$/);
      if (hm) {
        const k = hm[1].toLowerCase();
        const v = hm[2].trim();
        const which = Object.keys(HEADER_KEYS).find((name) => HEADER_KEYS[name].includes(k));
        if (which) { applyHeader(song, which, v, headerChords, lyricParts); continue; }
      }
      // 傳統寫法：「1=C 4/4 ♩=90」一行搞定
      if (/^1\s*=\s*[A-Ga-g]/.test(line)) {
        const km = line.match(/1\s*=\s*([A-Ga-g][#b♯♭]?\s*(?:m|小調|大調)?)/);
        if (km) applyHeader(song, 'key', km[1], headerChords, lyricParts);
        const mm = line.match(/(\d+)\s*\/\s*(\d+)/);
        if (mm) applyHeader(song, 'meter', mm[0], headerChords, lyricParts);
        const tm = line.match(/(?:♩|♪|bpm|速度|tempo)\s*=?\s*(\d+)/i) || line.match(/=\s*(\d{2,3})\s*$/);
        if (tm) applyHeader(song, 'tempo', tm[1], headerChords, lyricParts);
        continue;
      }
      if (/[0-7]/.test(line)) { noteLines.push(line); continue; }
      song.warnings.push(`看不懂這一行，先略過：「${line}」`);
    }

    let lastNote = null;
    let cursor = 0;
    for (const line of noteLines) {
      const cleaned = line.replace(/\|\|/g, '|').replace(/\|:/g, '|').replace(/:\|/g, '|');
      for (const seg of cleaned.split('|')) {
        if (!seg.trim()) continue;
        const barIndex = song.bars.length;
        const bar = { index: barIndex, start: cursor, beats: 0, notes: [], chords: [], tokens: [], text: seg.trim() };
        TOKEN_RE.lastIndex = 0;
        let m;
        while ((m = TOKEN_RE.exec(seg)) !== null) {
          if (m[1] !== undefined) {
            const c = parseChord(m[1].trim());
            if (c) bar.chords.push({ beat: bar.beats, chord: c, explicit: true });
            else song.warnings.push(`第 ${barIndex + 1} 小節：看不懂和弦「${m[1]}」，先略過`);
            continue;
          }
          if (m[3] !== undefined) {
            const deg = +m[3];
            let beats = 1;
            for (let u = 0; u < m[6].length; u++) beats /= 2;
            if (m[5] || m[7]) beats *= 1.5;
            let oct = 0;
            for (const ch of m[4]) oct += ch === ',' ? -1 : 1;
            const note = {
              deg, rest: deg === 0, acc: accOf(m[2]), oct, beats, dotted: !!(m[5] || m[7]), under: m[6].length,
              start: cursor + bar.beats, bar: barIndex, lyric: null,
            };
            bar.notes.push(note);
            bar.tokens.push({ kind: 'note', note });
            bar.beats += beats;
            lastNote = note;
            continue;
          }
          if (m[8] !== undefined) { // 延長線：前一個音再多一拍
            if (lastNote) {
              lastNote.beats += 1;
              bar.tokens.push({ kind: 'dash', note: lastNote });
            } else {
              song.warnings.push(`第 ${barIndex + 1} 小節：延長線「-」前面沒有音，當作休止`);
              const rest = { deg: 0, rest: true, acc: 0, oct: 0, beats: 1, start: cursor + bar.beats, bar: barIndex };
              bar.notes.push(rest);
              bar.tokens.push({ kind: 'note', note: rest });
              lastNote = rest;
            }
            bar.beats += 1;
            continue;
          }
          if (m[9] !== undefined || m[10] !== undefined) continue; // 空白、括號、連音線、逗號
          song.warnings.push(`第 ${barIndex + 1} 小節：看不懂「${m[11]}」，先略過`);
        }
        if (bar.beats === 0) {
          if (bar.chords.length && song.bars.length) song.bars[song.bars.length - 1].trailingChords = bar.chords;
          continue;
        }
        cursor += bar.beats;
        song.bars.push(bar);
      }
    }
    song.totalBeats = cursor;

    // 拍數檢查：弱起的第一小節、補齊弱起的最後一小節可以短，其他都應該等於拍號
    const n = song.bars.length;
    song.bars.forEach((bar, i) => {
      const diff = bar.beats - song.meter.num;
      if (Math.abs(diff) < 1e-6) return;
      if (diff < 0 && (i === 0 || i === n - 1)) { bar.pickup = true; return; }
      song.warnings.push(`第 ${i + 1} 小節有 ${trimNum(bar.beats)} 拍，但拍號是 ${song.meter.num}/${song.meter.den}（應為 ${song.meter.num} 拍）：「${bar.text}」`);
    });

    applyHeaderChords(song, headerChords);
    applyLyrics(song, lyricParts);
    return song;
  }

  function trimNum(x) { return Math.round(x * 100) / 100; }

  function applyHeader(song, which, v, headerChords, lyricParts) {
    switch (which) {
      case 'title': song.title = v; break;
      case 'key': {
        const k = parseKey(v);
        if (k) song.key = k; else song.warnings.push(`看不懂調性「${v}」，先用 C 大調`);
        break;
      }
      case 'meter': {
        const m = v.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) song.meter = { num: +m[1], den: +m[2] };
        else song.warnings.push(`看不懂拍號「${v}」，先用 4/4`);
        break;
      }
      case 'tempo': {
        const m = v.match(/\d+/);
        if (m) song.tempo = clamp(+m[0], 30, 240);
        else song.warnings.push(`看不懂速度「${v}」`);
        break;
      }
      case 'style': song.style = v; break;
      case 'lead': song.lead = v; break;
      case 'chords': headerChords.push(v); break;
      case 'lyrics': lyricParts.push(v); break;
    }
  }

  // 「和弦: C Am F G」一個小節一個；「和弦: C | Am F | G」有 | 的話每段是一個小節，段內平均分配
  function applyHeaderChords(song, headerChords) {
    let barPtr = 0;
    let prev = null;
    for (const lineText of headerChords) {
      const groups = lineText.includes('|')
        ? lineText.split('|').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/))
        : lineText.split(/\s+/).filter(Boolean).map((t) => [t]);
      for (const group of groups) {
        const bar = song.bars[barPtr++];
        if (!bar) { song.warnings.push('「和弦」列出的和弦比小節還多，多的先略過'); return; }
        if (bar.chords.length) continue; // 行內 [C] 優先
        group.forEach((tok, i) => {
          if (tok === '%' || tok === '-' || tok === '/') tok = prev;
          const c = tok && parseChord(tok);
          if (!c) { song.warnings.push(`第 ${bar.index + 1} 小節：看不懂和弦「${tok}」，先略過`); return; }
          bar.chords.push({ beat: (bar.beats * i) / group.length, chord: c, explicit: true });
          prev = c.symbol;
        });
      }
    }
  }

  // 歌詞只拿來顯示：中文一字一音，英文一字（空白分開）一音；標點黏在前一個字上
  function applyLyrics(song, lyricParts) {
    const text = lyricParts.join(' ').trim();
    if (!text) return;
    let tokens;
    if (/[A-Za-z]/.test(text) && /\s/.test(text)) tokens = text.split(/\s+/);
    else {
      tokens = [];
      for (const ch of text.replace(/\s+/g, '')) {
        if (/[，。、！？,.!?~…；;：:「」『』()（）]/.test(ch) && tokens.length) tokens[tokens.length - 1] += ch;
        else tokens.push(ch);
      }
    }
    let i = 0;
    for (const bar of song.bars) for (const note of bar.notes) {
      if (note.rest) continue;
      if (i < tokens.length) note.lyric = tokens[i++];
    }
    if (i < tokens.length) song.warnings.push(`歌詞比音符多了 ${tokens.length - i} 個字，多的沒有對到音`);
  }

  // 「1」不加點 = 中央 C 附近那個八度；調太高（G 以上）整體降八度，旋律才不會飄太高
  function midiOf(note, song, transpose) {
    const tonic = song.key.tonicPc;
    let base = 60 + tonic;
    if (tonic > 6) base -= 12;
    return base + MAJOR[note.deg - 1] + note.acc + 12 * note.oct + (transpose || 0);
  }

  // ───────────────────────── 自動配和弦 ─────────────────────────
  // 每小節在順階和弦裡挑一個最合旋律的：和弦內音加分（強拍加更多）、外音扣分，
  // 再加上一點「常見度」偏好（I、IV、V 優先），開頭和結尾偏向主和弦、倒數第二小節偏向屬和弦。
  // 4 拍以上的小節如果前後半各配一個明顯更合，就拆成兩個和弦。
  function harmonize(song) {
    const key = song.key;
    const minor = key.mode === 'minor';
    const mk = (deg, q, prior, role) => {
      const c = parseChord(pcName(key.tonicPc + MAJOR[deg], key.flat) + q);
      c.prior = prior; c.role = role;
      return c;
    };
    const cands = minor
      ? [mk(5, 'm', 0.45, 'I'), mk(1, 'm', 0.15, 'IV'), mk(2, '', 0.3, 'V'), mk(3, '', 0.15, 'VI'), mk(0, '', 0.12, 'III'), mk(4, '', 0.05, 'VII')]
      : [mk(0, '', 0.45, 'I'), mk(3, '', 0.3, 'IV'), mk(4, '', 0.35, 'V'), mk(5, 'm', 0.2, 'vi'), mk(1, 'm', 0, 'ii'), mk(2, 'm', -0.1, 'iii')];

    const n = song.bars.length;
    // run 記錄同一個和弦已經連續幾個小節：第三小節起扣分，旋律兩個都合時就會換一個，不會一路 C 到底
    let prev = null, run = 0;
    const advance = (c) => { run = prev && c.symbol === prev.symbol ? run + 1 : 0; prev = c; };
    song.bars.forEach((bar, i) => {
      if (bar.chords.length) { advance(bar.chords[bar.chords.length - 1].chord); return; }
      const notes = bar.notes.filter((x) => !x.rest);
      if (!notes.length) { const c = prev || cands[0]; bar.chords.push({ beat: 0, chord: c, auto: true }); advance(c); return; }

      const weightOf = (note) => {
        const pos = note.start - bar.start;
        const onDown = pos < 1e-6;
        const onBeat = Math.abs(pos - Math.round(pos)) < 1e-6;
        return note.beats * (onDown ? 1.4 : onBeat ? 1.2 : 0.8);
      };
      const scoreOf = (cand, subset, ctx) => {
        let s = 0;
        for (const note of subset) {
          const pc = mod12(midiOf(note, song));
          const w = weightOf(note);
          s += cand.pcs.includes(pc) ? w : -0.4 * w;
        }
        s += cand.prior;
        if (prev && cand.symbol === prev.symbol) s += run >= 1 ? -0.35 : 0.1;
        if (ctx.first && cand.role === 'I') s += 0.8;
        if (ctx.last && cand.role === 'I') s += 2;
        if (ctx.penult && cand.role === 'V') s += 0.7;
        return s;
      };
      const best = (subset, ctx) => {
        let b = null, bs = -Infinity;
        for (const c of cands) { const s = scoreOf(c, subset, ctx); if (s > bs) { bs = s; b = c; } }
        return { chord: b, score: bs };
      };

      const ctx = { first: i === 0, last: i === n - 1, penult: i === n - 2 };
      const whole = best(notes, ctx);
      let chosen = [{ beat: 0, chord: whole.chord, auto: true }];
      if (bar.beats >= 4 && notes.length >= 3 && !ctx.last) {
        const half = bar.beats / 2;
        const a = notes.filter((x) => x.start - bar.start < half - 1e-6);
        const b = notes.filter((x) => x.start - bar.start >= half - 1e-6);
        if (a.length && b.length) {
          const ba = best(a, { first: ctx.first });
          const saved = prev; prev = ba.chord;
          const bb = best(b, { penult: ctx.penult });
          prev = saved;
          if (ba.chord.symbol !== bb.chord.symbol && ba.score + bb.score > whole.score + 1.2) {
            chosen = [{ beat: 0, chord: ba.chord, auto: true }, { beat: half, chord: bb.chord, auto: true }];
          }
        }
      }
      bar.chords = chosen;
      if (chosen.length === 2) advance(chosen[0].chord);
      advance(chosen[chosen.length - 1].chord);
    });
    return song;
  }

  // ───────────────────────── 樂器與曲風 ─────────────────────────
  const INSTRUMENTS = {
    piano: { label: '鋼琴', gm: 0 },
    epiano: { label: '電鋼琴', gm: 4 },
    guitar: { label: '吉他', gm: 24 },
    flute: { label: '長笛', gm: 73 },
    musicbox: { label: '八音盒', gm: 10, octave: 12 },
    synth: { label: '合成器', gm: 81 },
    strings: { label: '弦樂', gm: 48 },
    pad: { label: '合成鋪底', gm: 89 },
    bass: { label: '貝斯', gm: 33 },
    drums: { label: '鼓組', gm: 0 },
  };
  const INSTRUMENT_ALIASES = {
    piano: ['鋼琴', 'piano', '琴'], epiano: ['電鋼琴', 'epiano', 'rhodes', '電琴'],
    guitar: ['吉他', 'guitar', '木吉他', '尼龍吉他'], flute: ['長笛', '笛', '笛子', '直笛', '口哨', 'flute', 'whistle', 'recorder'],
    musicbox: ['八音盒', '音樂盒', '音樂鐘', 'musicbox', 'music box', 'bell', '鐘琴'],
    synth: ['合成器', 'synth', '電子', 'lead'], strings: ['弦樂', '小提琴', 'strings', 'violin'],
  };
  const LEAD_CHOICES = ['piano', 'epiano', 'guitar', 'flute', 'musicbox', 'synth', 'strings'];

  // 節奏格：每拍 4 格（16 分音符）。鼓的字串：X 重、x 中、g 輕、. 沒有。
  // bass: [格, 音(r 根音 / 5 五度 / 3 三度 / o 高八度根音), 長度(格)]
  // chord: { type: block | arp | strum | power | sustain, hits: [[格, 長度(格), 方向]], order: 琶音順序 }
  const STYLES = {
    pop: {
      label: '流行抒情', tempo: 84, lead: 'piano', chord: 'piano', bass: 'bass', pad: 'pad', drums: true, reverb: 0.25,
      patterns: {
        4: {
          drums: { k: 'X.....x.X.......', s: '....X.......X...', h: 'X.x.x.x.X.x.x.x.' },
          bass: [[0, 'r', 6], [6, 'r', 2], [8, 'r', 6], [14, '5', 2]],
          chord: { type: 'arp', step: 2, len: 5, order: [0, 1, 2, 3, 2, 1, 2, 3] },
        },
        3: {
          drums: { k: 'X...........', s: '........X...', h: 'X.x.x.x.x.x.' },
          bass: [[0, 'r', 8], [8, '5', 4]],
          chord: { type: 'arp', step: 2, len: 5, order: [0, 1, 2, 3, 2, 1] },
        },
        6: {
          drums: { k: 'X...........X...........', s: '............X...........', h: 'X...x...x...X...x...x...' },
          bass: [[0, 'r', 12], [12, '5', 12]],
          chord: { type: 'arp', step: 4, len: 8, order: [0, 1, 2, 3, 2, 1] },
        },
      },
    },
    folk: {
      label: '民謠', tempo: 96, lead: 'flute', chord: 'guitar', bass: 'bass', pad: null, drums: true, reverb: 0.2,
      patterns: {
        4: {
          drums: { k: 'X.......X.......', r: '....x.......x...', m: 'x.x.x.x.x.x.x.x.' },
          bass: [[0, 'r', 8], [8, '5', 8]],
          chord: { type: 'strum', hits: [[0, 4, 'd'], [4, 2, 'd'], [6, 4, 'u'], [10, 2, 'u'], [12, 2, 'd'], [14, 2, 'u']] },
        },
        3: {
          drums: { k: 'X...........', m: 'x.x.x.x.x.x.' },
          bass: [[0, 'r', 12]],
          chord: { type: 'strum', hits: [[0, 4, 'd'], [4, 4, 'd'], [8, 2, 'd'], [10, 2, 'u']] },
        },
      },
    },
    bossa: {
      label: 'Bossa Nova', tempo: 120, lead: 'flute', chord: 'guitar', bass: 'bass', pad: null, drums: true, reverb: 0.18,
      patterns: {
        4: {
          drums: { k: 'X.....x.X.....x.', r: 'x..x..x...x.x...', m: 'x.x.x.x.x.x.x.x.' },
          bass: [[0, 'r', 6], [6, 'r', 2], [8, '5', 6], [14, '5', 2]],
          chord: { type: 'block', hits: [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4]] },
        },
      },
    },
    rock: {
      label: '搖滾', tempo: 120, lead: 'synth', chord: 'guitar', bass: 'bass', pad: null, drums: true, reverb: 0.15,
      patterns: {
        4: {
          drums: { k: 'X.....x.X.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
          bass: [[0, 'r', 2], [2, 'r', 2], [4, 'r', 2], [6, 'r', 2], [8, 'r', 2], [10, 'r', 2], [12, 'r', 2], [14, 'r', 2]],
          chord: { type: 'power', hits: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]] },
        },
        3: {
          drums: { k: 'X.......x...', s: '....X...X...', h: 'x.x.x.x.x.x.' },
          bass: [[0, 'r', 2], [2, 'r', 2], [4, 'r', 2], [6, 'r', 2], [8, 'r', 2], [10, 'r', 2]],
          chord: { type: 'power', hits: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2]] },
        },
      },
    },
    musicbox: {
      label: '八音盒', tempo: 76, lead: 'musicbox', chord: 'musicbox', bass: 'musicbox', pad: null, drums: false, reverb: 0.4,
      patterns: (beats) => ({
        drums: {},
        bass: [[0, 'r', beats * 4]],
        chord: { type: 'arp', step: 2, len: 6, order: [0, 1, 2, 3, 2, 1] },
      }),
    },
    kids: {
      label: '兒歌', tempo: 108, lead: 'flute', chord: 'piano', bass: 'bass', pad: null, drums: true, reverb: 0.18,
      patterns: {
        4: {
          drums: { k: 'X.......X.......', c: '....x.......x...', m: 'x.x.x.x.x.x.x.x.' },
          bass: [[0, 'r', 4], [8, '5', 4]],
          chord: { type: 'block', hits: [[4, 3], [12, 3]] },
        },
        2: {
          drums: { k: 'X.......', c: '....x...', m: 'x.x.x.x.' },
          bass: [[0, 'r', 4]],
          chord: { type: 'block', hits: [[4, 3]] },
        },
        3: {
          drums: { k: 'X...........', c: '....x...x...', m: 'x.x.x.x.x.x.' },
          bass: [[0, 'r', 4]],
          chord: { type: 'block', hits: [[4, 3], [8, 3]] },
        },
      },
    },
    waltz: {
      label: '華爾滋', tempo: 132, lead: 'piano', chord: 'piano', bass: 'bass', pad: 'strings', drums: true, reverb: 0.25,
      patterns: {
        3: {
          drums: { k: 'X...........', h: '....x...x...' },
          bass: [[0, 'r', 4]],
          chord: { type: 'block', hits: [[4, 3], [8, 3]] },
        },
        4: {
          drums: { k: 'X.......X.......', h: '....x.......x...' },
          bass: [[0, 'r', 4], [8, '5', 4]],
          chord: { type: 'block', hits: [[4, 3], [12, 3]] },
        },
      },
    },
  };
  const STYLE_ALIASES = {
    pop: ['流行', '抒情', '流行抒情', '情歌', 'pop', 'ballad', '鋼琴'],
    folk: ['民謠', '校園民謠', '吉他', 'folk', 'acoustic', '木吉他'],
    bossa: ['bossa', 'bossa nova', '波薩', '巴莎', '爵士', 'jazz', '慵懶', 'lounge'],
    rock: ['搖滾', '樂團', 'rock', 'band', '熱血'],
    musicbox: ['八音盒', '音樂盒', '音樂鐘', '搖籃曲', 'musicbox', 'music box', 'lullaby', '療癒'],
    kids: ['兒歌', '童謠', '可愛', '活潑', 'kids', 'children', '兒童', '幼兒'],
    waltz: ['華爾滋', '圓舞曲', '三拍', 'waltz'],
  };

  // 先找完全相同的，再找「包含」的別名裡最長的那個（「電鋼琴」要贏過「鋼琴」）
  function resolveAlias(table, raw, fallback) {
    if (!raw) return fallback;
    const s = String(raw).trim().toLowerCase();
    if (table[s]) return s;
    let best = null, bestLen = 0;
    for (const id of Object.keys(table)) {
      for (const alias of table[id]) {
        const a = alias.toLowerCase();
        if (s === a) return id;
        if (s.includes(a) && a.length > bestLen) { best = id; bestLen = a.length; }
      }
    }
    return best || fallback;
  }
  const resolveStyle = (raw, meter) => resolveAlias(STYLE_ALIASES, raw, meter && meter.num === 3 ? 'waltz' : 'pop');
  const resolveInstrument = (raw, fallback) => resolveAlias(INSTRUMENT_ALIASES, raw, fallback);

  // 沒定義該拍數的曲風：從 4 拍的版本截短，或用最陽春的「一拍一下」
  function patternFor(style, beats) {
    if (typeof style.patterns === 'function') return style.patterns(beats);
    if (style.patterns[beats]) return style.patterns[beats];
    const steps = beats * 4;
    const base = style.patterns[4] || style.patterns[3] || Object.values(style.patterns)[0];
    if (base && beats < 4) {
      const cut = (s) => s.slice(0, steps);
      const drums = {};
      for (const lane of Object.keys(base.drums)) drums[lane] = cut(base.drums[lane]);
      return {
        drums,
        bass: base.bass.filter((b) => b[0] < steps).map((b) => [b[0], b[1], Math.min(b[2], steps - b[0])]),
        chord: base.chord.hits
          ? Object.assign({}, base.chord, { hits: base.chord.hits.filter((h) => h[0] < steps) })
          : base.chord,
      };
    }
    const hh = []; for (let i = 0; i < steps; i++) hh.push(i % 4 === 0 ? 'x' : '.');
    const kick = hh.map((c, i) => (i === 0 || i === steps / 2 ? 'X' : '.')).join('');
    return {
      drums: { k: kick, h: hh.join('') },
      bass: [[0, 'r', steps / 2], [steps / 2, '5', steps / 2]],
      chord: { type: 'block', hits: [[0, steps / 2], [steps / 2, steps / 2]] },
    };
  }

  // ───────────────────────── 編曲 ─────────────────────────
  // ───────────────────────── 混音 ─────────────────────────
  // 每軌：volume 音量、pan 左右（-1 左 … 1 右）、tone 音色（-1 暗 … 1 亮）、reverb 殘響量（0 … 1）
  const DEFAULT_MIX = {
    lead: { volume: 1, pan: 0.08, tone: 0, reverb: 0.5, mute: false },
    chords: { volume: 0.7, pan: -0.3, tone: 0, reverb: 0.6, mute: false },
    bass: { volume: 0.85, pan: 0, tone: 0, reverb: 0.15, mute: false },
    pad: { volume: 0.45, pan: 0.3, tone: -0.2, reverb: 0.9, mute: false },
    drums: { volume: 0.8, pan: 0, tone: 0, reverb: 0.35, mute: false },
    layer: { volume: 0.55, pan: -0.15, tone: 0, reverb: 0.6, mute: false },
  };
  // 母帶預設：low/high 是 dB，hp/lp 是 Hz，threshold/ratio 給總壓縮器，reverbMul 乘在曲風的殘響量上
  const MASTER_PRESETS = {
    natural: { label: '原味', low: 0, high: 0, hp: 20, lp: 20000, threshold: -16, ratio: 4, reverbMul: 1 },
    warm: { label: '溫暖', low: 3, high: -2.5, hp: 20, lp: 9000, threshold: -16, ratio: 4, reverbMul: 1.1 },
    bright: { label: '明亮', low: -1, high: 3.5, hp: 40, lp: 20000, threshold: -16, ratio: 4, reverbMul: 0.9 },
    lofi: { label: 'Lo-fi', low: 2, high: -6, hp: 120, lp: 3200, threshold: -24, ratio: 8, reverbMul: 0.6 },
    radio: { label: '廣播', low: 0, high: 2, hp: 350, lp: 4500, threshold: -28, ratio: 12, reverbMul: 0.4 },
    hall: { label: '大場地', low: 1, high: 1, hp: 20, lp: 20000, threshold: -16, ratio: 4, reverbMul: 2.2 },
  };
  // 鼓組裡幾個小件放到左右，不然整組鼓擠在中間
  const DRUM_PAN = { 42: 0.25, 46: 0.25, 70: -0.3, 54: -0.2, 37: 0.15, 51: 0.3, 49: -0.2 };

  const DRUM_NOTE = { k: 36, s: 38, r: 37, c: 39, h: 42, o: 46, m: 70, t: 54, C: 49, R: 51 };
  const DRUM_LABEL = { k: '大鼓', s: '小鼓', r: '鼓邊', c: '拍手', h: 'Hi-hat', o: '開鈸', m: '沙鈴', t: '鈴鼓', C: '碎音鈸', R: 'Ride' };

  function voicing(chord, type) {
    const r = chord.root;
    const third = chord.intervals.length > 1 ? chord.intervals[1] : 4;
    const fifth = chord.intervals.length > 2 ? chord.intervals[2] : 7;
    const seventh = chord.intervals[3] !== undefined && chord.intervals[3] < 12 ? chord.intervals[3] : null;
    const mid = 48 + r; // C3..B3
    switch (type) {
      case 'arp': return [mid, mid + fifth, mid + 12, mid + 12 + third];
      case 'strum': { const low = 40 + r; return [low, low + fifth, low + 12, low + 12 + third, low + 12 + fifth, low + 24]; }
      case 'power': { const low = 40 + r; return [low, low + fifth, low + 12]; }
      case 'sustain': return [mid, mid + third, mid + fifth].concat(seventh !== null ? [mid + seventh] : []);
      default: { // block
        const v = [mid, mid + third, mid + fifth];
        if (seventh !== null) v.push(mid + seventh);
        return v;
      }
    }
  }

  function bassNote(chord, which) {
    const root = 36 + chord.bass; // C2..B2
    if (which === '5') { const f = root + 7; return f > 50 ? root - 5 : f; }
    if (which === '3') return root + (chord.intervals[1] || 4);
    if (which === 'o') return root + 12;
    return root;
  }

  // 各軌可以挑的樂器
  const CHORD_CHOICES = ['piano', 'epiano', 'guitar', 'musicbox', 'synth', 'strings'];
  const BASS_CHOICES = ['bass', 'synth', 'musicbox', 'piano'];
  const PAD_CHOICES = ['pad', 'strings'];
  // 加軌用的和弦節奏型
  const LAYER_PATTERNS = {
    arp: { label: '琶音', type: 'arp', step: 2, len: 5, order: [0, 1, 2, 3, 2, 1, 2, 3] },
    arp16: { label: '快琶音', type: 'arp', step: 1, len: 3, order: [0, 1, 2, 3, 2, 1] },
    block: { label: '每拍齊奏', type: 'block', hits: [[0, 4], [4, 4], [8, 4], [12, 4], [16, 4], [20, 4]] },
    offbeat: { label: '反拍', type: 'block', hits: [[2, 2], [6, 2], [10, 2], [14, 2], [18, 2], [22, 2]] },
    strum: { label: '刷弦', type: 'strum', hits: [[0, 4, 'd'], [4, 2, 'd'], [6, 4, 'u'], [10, 2, 'u'], [12, 2, 'd'], [14, 2, 'u'], [16, 4, 'd'], [20, 4, 'd']] },
    sustain: { label: '長音', type: 'sustain' },
  };

  // opts:
  //   style, lead, transpose, tempo
  //   instruments: { chords: 'guitar', bass: 'bass', pad: 'strings' | null }   換伴奏樂器；pad 給 null 就關掉鋪底
  //   layers: [{ role: 'lead' | 'chords', inst: 'strings', octave: -1 | 0 | 1, pattern: 'arp' | ... }]   疊上去的額外音軌
  function arrange(song, opts) {
    opts = opts || {};
    const styleId = resolveStyle(opts.style || song.style, song.meter);
    const style = STYLES[styleId];
    const transpose = opts.transpose || 0;
    const leadId = resolveInstrument(opts.lead || song.lead, style.lead);
    const den = song.meter.den;
    const tempo = opts.tempo || song.tempo || Math.round(style.tempo * den / 4);
    const insts = opts.instruments || {};
    const chordInst = INSTRUMENTS[insts.chords] ? insts.chords : style.chord;
    const bassInst = INSTRUMENTS[insts.bass] ? insts.bass : style.bass;
    const padInst = insts.pad === null || insts.pad === 'none' ? null : (INSTRUMENTS[insts.pad] ? insts.pad : style.pad);
    const octaveOf = (inst) => INSTRUMENTS[inst].octave || 0;
    const leadShift = octaveOf(leadId);
    const bassShift = bassInst === 'musicbox' ? 12 : bassInst === 'piano' ? 0 : 0;

    const mk = (id, name, inst, channel, volume) => ({ id, name, inst, channel, volume, events: [], mix: Object.assign({}, DEFAULT_MIX[id] || DEFAULT_MIX.layer, { volume }) });
    const tracks = {
      lead: mk('lead', '主旋律', leadId, 0, 1.0),
      chords: mk('chords', '和弦', chordInst, 1, 0.7),
      bass: mk('bass', '貝斯', bassInst, 2, 0.85),
      pad: mk('pad', '鋪底', padInst || 'pad', 3, 0.45),
      drums: mk('drums', '鼓', 'drums', 9, 0.8),
    };
    const layers = (opts.layers || []).filter((l) => l && INSTRUMENTS[l.inst]).map((l, i) => {
      const id = 'layer' + (i + 1);
      const inst = l.inst;
      const role = l.role === 'lead' ? 'lead' : 'chords';
      const pattern = LAYER_PATTERNS[l.pattern] || (role === 'lead' ? null : LAYER_PATTERNS.block);
      const label = `${role === 'lead' ? '疊旋律' : pattern.label}·${INSTRUMENTS[inst].label}`;
      tracks[id] = mk(id, label, inst, 4 + i + (4 + i >= 9 ? 1 : 0), 0.55);
      tracks[id].layer = { role, inst, octave: l.octave || 0, pattern: l.pattern || (role === 'lead' ? null : 'block') };
      return { id, role, inst, shift: octaveOf(inst) + 12 * (l.octave || 0), pattern };
    });

    // 主旋律：同音反覆之間留一點空隙，聽起來才有「彈」的感覺
    const leadNotes = [];
    song.bars.forEach((bar) => bar.notes.forEach((note) => {
      if (note.rest) return;
      const gap = Math.min(0.12, note.beats * 0.15);
      const onDown = Math.abs(note.start - bar.start) < 1e-6;
      leadNotes.push(note);
      const base = { t: note.start, dur: note.beats - gap, vel: onDown ? 0.95 : 0.82, ref: leadNotes.length - 1 };
      const midi = midiOf(note, song, transpose);
      tracks.lead.events.push(Object.assign({ note: midi + leadShift }, base));
      for (const ly of layers) if (ly.role === 'lead') tracks[ly.id].events.push(Object.assign({}, base, { note: midi + ly.shift, vel: base.vel * 0.8 }));
    }));

    // 和弦區段：每個小節裡（含前一小節延續）哪一拍起用什麼和弦
    const segments = [];
    let current = null;
    song.bars.forEach((bar) => {
      const list = bar.chords.slice().sort((a, b) => a.beat - b.beat);
      if (!list.length || list[0].beat > 1e-6) {
        if (current) segments.push({ start: bar.start, end: bar.start + (list.length ? list[0].beat : bar.beats), chord: current, bar });
      }
      list.forEach((c, i) => {
        const end = i + 1 < list.length ? bar.start + list[i + 1].beat : bar.start + bar.beats;
        segments.push({ start: bar.start + c.beat, end, chord: c.chord, bar });
        current = c.chord;
      });
    });
    const chordAt = (beat) => {
      let found = null;
      for (const s of segments) { if (s.start <= beat + 1e-6) found = s.chord; else break; }
      return found;
    };

    // 和弦類音軌：主和弦軌用曲風的節奏型，加軌用自己選的
    const chordTracks = [{ id: 'chords', shift: octaveOf(chordInst), pattern: null }]
      .concat(layers.filter((l) => l.role === 'chords' && l.pattern.type !== 'sustain').map((l) => ({ id: l.id, shift: l.shift, pattern: l.pattern })));
    const sustainTracks = (padInst ? [{ id: 'pad', shift: 0 }] : [])
      .concat(layers.filter((l) => l.role === 'chords' && l.pattern.type === 'sustain').map((l) => ({ id: l.id, shift: l.shift })));

    const genChords = (trackId, cp, shift, bar, steps, tAt) => {
      const push = (ev) => tracks[trackId].events.push(ev);
      if (cp.type === 'arp') {
        let k = 0;
        for (let s = 0; s < steps; s += cp.step) {
          const chord = chordAt(tAt(s));
          if (!chord) continue;
          const v = voicing(chord, 'arp');
          const idx = cp.order[k % cp.order.length];
          push({ t: tAt(s), dur: cp.len / 4, note: v[idx % v.length] + shift + transpose, vel: s % 4 === 0 ? 0.75 : 0.6 });
          k++;
        }
        return;
      }
      for (const hit of cp.hits) {
        const [step, len, dir] = hit;
        if (step >= steps) continue;
        const chord = chordAt(tAt(step));
        if (!chord) continue;
        const dur = Math.min(len, steps - step) / 4;
        let v = voicing(chord, cp.type);
        if (cp.type === 'strum' && dir === 'u') v = v.slice(2).reverse();
        v.forEach((nn, i) => push({
          t: tAt(step), off: cp.type === 'strum' ? i * 0.014 : 0, dur,
          note: nn + shift + transpose, vel: (step % 4 === 0 ? 0.78 : 0.62) * (cp.type === 'power' ? 0.9 : 1),
        }));
      }
    };

    const n = song.bars.length;
    let firstFull = true;
    song.bars.forEach((bar, bi) => {
      const isLast = bi === n - 1;
      const steps = Math.round(bar.beats * 4);
      // 弱起小節只有旋律，伴奏從第一個完整小節進來
      if (bar.pickup && bi === 0) return;
      const pat = patternFor(style, song.meter.num);
      const tAt = (step) => bar.start + step / 4;
      const push = (track, ev) => tracks[track].events.push(ev);

      if (isLast && !bar.pickup) {
        // 結尾：一個長和弦收掉，鼓敲一下碎音鈸
        const chord = chordAt(bar.start);
        if (chord) {
          for (const ct of chordTracks) voicing(chord, 'block').forEach((nn) => push(ct.id, { t: bar.start, dur: bar.beats, note: nn + ct.shift + transpose, vel: 0.8 }));
          push('bass', { t: bar.start, dur: bar.beats, note: bassNote(chord, 'r') + bassShift + transpose, vel: 0.9 });
          for (const st of sustainTracks) voicing(chord, 'sustain').forEach((nn) => push(st.id, { t: bar.start, dur: bar.beats, note: nn + st.shift + transpose, vel: 0.6 }));
        }
        if (style.drums) { push('drums', { t: bar.start, dur: 1, note: DRUM_NOTE.C, vel: 0.8 }); push('drums', { t: bar.start, dur: 0.5, note: DRUM_NOTE.k, vel: 1 }); }
        return;
      }

      // 鼓
      if (style.drums) {
        if (firstFull) push('drums', { t: bar.start, dur: 1, note: DRUM_NOTE.C, vel: 0.6 });
        for (const lane of Object.keys(pat.drums)) {
          const str = pat.drums[lane];
          for (let s = 0; s < Math.min(steps, str.length); s++) {
            const ch = str[s];
            if (ch === '.') continue;
            const vel = ch === 'X' ? 1 : ch === 'x' ? 0.75 : 0.45;
            push('drums', { t: tAt(s), dur: 0.25, note: DRUM_NOTE[lane], vel });
          }
        }
      }
      firstFull = false;

      // 貝斯
      for (const [step, which, len] of pat.bass) {
        if (step >= steps) continue;
        const chord = chordAt(tAt(step));
        if (!chord) continue;
        const dur = Math.min(len, steps - step) / 4;
        push('bass', { t: tAt(step), dur: dur * 0.95, note: bassNote(chord, which) + bassShift + transpose, vel: step === 0 ? 0.95 : 0.8 });
      }

      // 和弦樂器（主軌 + 加軌）
      for (const ct of chordTracks) genChords(ct.id, ct.pattern || pat.chord, ct.shift, bar, steps, tAt);
    });

    // 鋪底、長音加軌：跟著和弦區段長音
    if (sustainTracks.length) {
      const lastBar = song.bars[n - 1];
      for (const seg of segments) {
        if (seg.bar.pickup && seg.bar.index === 0) continue;
        if (seg.bar === lastBar) continue;
        for (const st of sustainTracks) voicing(seg.chord, 'sustain').forEach((nn) => tracks[st.id].events.push({ t: seg.start, dur: seg.end - seg.start, note: nn + st.shift + transpose, vel: 0.55 }));
      }
    }

    const order = ['lead', 'chords', 'bass', 'pad', 'drums'].concat(layers.map((l) => l.id));
    const list = order.map((id) => tracks[id]).filter((t) => t && t.events.length);
    list.forEach((t) => t.events.sort((a, b) => a.t - b.t));
    return {
      style: styleId, styleLabel: style.label, lead: leadId, tempo, transpose, reverb: style.reverb,
      instruments: { chords: chordInst, bass: bassInst, pad: padInst },
      totalBeats: song.totalBeats, segments, tracks: list, leadNotes,
      keyName: keyName(song.key, transpose),
    };
  }

  // ───────────────────────── MIDI 檔 ─────────────────────────
  function varLen(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }
  const strBytes = (s) => Array.from(new TextEncoder().encode(s));
  const sharpsOf = (pc) => { const t = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][mod12(pc)]; return t; };

  function toMidi(arr, song, mix) {
    const den = song.meter.den;
    const tpq = 480;
    const ticksPerBeat = Math.round(tpq * 4 / den);
    const usPerQuarter = Math.round(60e6 / (arr.tempo * 4 / den));
    const tick = (beats) => Math.round(beats * ticksPerBeat);
    const secToTicks = (sec) => Math.round(sec / (60 / arr.tempo) * ticksPerBeat);

    const trackBytes = (events) => {
      events.sort((a, b) => a.tick - b.tick || a.order - b.order);
      const out = [];
      let last = 0;
      for (const e of events) { out.push(...varLen(e.tick - last), ...e.data); last = e.tick; }
      out.push(0x00, 0xff, 0x2f, 0x00);
      return out;
    };
    const chunk = (id, bytes) => [...strBytes(id), (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes];

    const meta = [];
    const title = song.title || 'one-man-band';
    meta.push({ tick: 0, order: 0, data: [0xff, 0x03, ...varLen(strBytes(title).length), ...strBytes(title)] });
    meta.push({ tick: 0, order: 1, data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] });
    meta.push({ tick: 0, order: 2, data: [0xff, 0x58, 0x04, song.meter.num, Math.round(Math.log2(den)), 24, 8] });
    const sf = sharpsOf(song.key.tonicPc + arr.transpose);
    meta.push({ tick: 0, order: 3, data: [0xff, 0x59, 0x02, sf & 255, song.key.mode === 'minor' ? 1 : 0] });
    for (const seg of arr.segments) {
      const s = strBytes(seg.chord.symbol);
      meta.push({ tick: tick(seg.start), order: 4, data: [0xff, 0x06, ...varLen(s.length), ...s] });
    }
    const chunks = [chunk('MTrk', trackBytes(meta))];

    for (const tr of arr.tracks) {
      const ch = tr.channel;
      const evs = [];
      const name = strBytes(`${tr.name} (${INSTRUMENTS[tr.inst].label})`);
      evs.push({ tick: 0, order: 0, data: [0xff, 0x03, ...varLen(name.length), ...name] });
      if (ch !== 9) evs.push({ tick: 0, order: 1, data: [0xc0 | ch, INSTRUMENTS[tr.inst].gm] });
      const mp = trackParams(tr, mix);
      evs.push({ tick: 0, order: 2, data: [0xb0 | ch, 7, Math.round(clamp(mp.volume, 0, 1) * 127)] });
      evs.push({ tick: 0, order: 2, data: [0xb0 | ch, 10, Math.round(clamp((mp.pan + 1) / 2, 0, 1) * 127)] });
      for (const e of tr.events) {
        const on = tick(e.t) + (e.off ? secToTicks(e.off) : 0);
        const dur = Math.max(1, tick(e.dur));
        const vel = clamp(Math.round(e.vel * 127), 1, 127);
        const note = clamp(e.note, 0, 127);
        evs.push({ tick: on, order: 3, data: [0x90 | ch, note, vel] });
        evs.push({ tick: on + dur, order: 2, data: [0x80 | ch, note, 64] });
      }
      chunks.push(chunk('MTrk', trackBytes(evs)));
    }
    const header = chunk('MThd', [0, 1, 0, chunks.length, (tpq >> 8) & 255, tpq & 255]);
    return new Uint8Array([...header, ...chunks.flat()]);
  }

  // ───────────────────────── 瀏覽器：合成器 ─────────────────────────
  // 完全用 WebAudio 的振盪器和雜訊合成，不需要載入任何音色檔，離線也能播。
  function makeNoise(ctx, seconds) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Synth {
    constructor(ctx, opts) {
      opts = opts || {};
      this.ctx = ctx;
      // 母帶鏈：各軌 → master → 低/高架 EQ → 高通/低通 → 壓縮 → 限幅 → 喇叭
      this.master = ctx.createGain();
      this.master.gain.value = opts.volume == null ? 0.6 : opts.volume;
      this.eqLow = ctx.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 200;
      this.eqHigh = ctx.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4000;
      this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20; this.hp.Q.value = 0.6;
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.6;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 18; this.comp.ratio.value = 4;
      this.comp.attack.value = 0.004; this.comp.release.value = 0.16;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
      this.master.connect(this.eqLow); this.eqLow.connect(this.eqHigh); this.eqHigh.connect(this.hp); this.hp.connect(this.lp);
      this.lp.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(ctx.destination);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeImpulse(ctx, 1.8, 2.6);
      this.baseReverb = opts.reverb == null ? 0.22 : opts.reverb;
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = this.baseReverb;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);
      this.noise = makeNoise(ctx, 1.5);
      this.tracks = {};
      this.drumPans = {};
      this.setMaster(opts.master || 'natural');
    }
    setMaster(presetId) {
      const p = MASTER_PRESETS[presetId] || MASTER_PRESETS.natural;
      const t = this.ctx.currentTime, k = 0.03;
      this.eqLow.gain.setTargetAtTime(p.low, t, k); this.eqHigh.gain.setTargetAtTime(p.high, t, k);
      this.hp.frequency.setTargetAtTime(p.hp, t, k); this.lp.frequency.setTargetAtTime(p.lp, t, k);
      this.comp.threshold.setTargetAtTime(p.threshold, t, k); this.comp.ratio.setTargetAtTime(p.ratio, t, k);
      this.reverbGain.gain.setTargetAtTime(this.baseReverb * p.reverbMul, t, k);
    }
    // 每軌：gain → 低架/高架（音色）→ 左右 → master，另外從左右之後送一份去殘響
    track(id, params) {
      if (!this.tracks[id]) {
        const ctx = this.ctx;
        const gain = ctx.createGain();
        const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;
        const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3500;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const send = ctx.createGain();
        gain.connect(low); low.connect(high);
        const out = pan || high;
        if (pan) high.connect(pan);
        out.connect(this.master); out.connect(send); send.connect(this.reverb);
        this.tracks[id] = { gain, low, high, pan, send, input: gain };
      }
      if (params) this.setTrack(id, params);
      return this.tracks[id].input;
    }
    setTrack(id, p) {
      const n = this.tracks[id] || (this.track(id), this.tracks[id]);
      const t = this.ctx.currentTime, k = 0.02;
      if (p.volume != null || p.mute != null) n.gain.gain.setTargetAtTime(p.mute ? 0 : (p.volume == null ? 1 : p.volume), t, k);
      if (p.tone != null) { n.low.gain.setTargetAtTime(-p.tone * 6, t, k); n.high.gain.setTargetAtTime(p.tone * 6, t, k); }
      if (p.pan != null && n.pan) n.pan.pan.setTargetAtTime(clamp(p.pan, -1, 1), t, k);
      if (p.reverb != null) n.send.gain.setTargetAtTime(clamp(p.reverb, 0, 1) * 1.2, t, k);
    }
    setVolume(id, v) { this.setTrack(id, { volume: v }); }

    play(inst, note, t, dur, vel, dest) {
      dest = dest || this.master;
      if (inst === 'drums') return this.drum(note, t, vel, dest);
      const f = mtof(note);
      const v = clamp(vel, 0, 1);
      switch (inst) {
        case 'piano': return this.voice(dest, t, dur, {
          oscs: [['triangle', 1, 0.55, 0], ['sine', 2, 0.16, 0], ['sawtooth', 1, 0.1, 5]], f, gain: 0.5 * v,
          filter: [1100 + v * 3200, 700, 0.35], a: 0.004, tau: clamp(1.6 - (note - 48) / 60, 0.45, 1.6), r: 0.1,
        });
        case 'epiano': return this.voice(dest, t, dur, {
          oscs: [['sine', 1, 0.6, 0], ['sine', 2, 0.1, 0], ['sine', 4, 0.12, 0]], f, gain: 0.55 * v,
          filter: [2500 + v * 2500, 1200, 0.3], a: 0.004, tau: 1.2, r: 0.12,
        });
        case 'guitar': return this.voice(dest, t, dur, {
          oscs: [['triangle', 1, 0.5, 0], ['sawtooth', 1, 0.18, 3], ['sine', 2, 0.1, 0]], f, gain: 0.45 * v,
          filter: [1800 + v * 1800, 800, 0.25], a: 0.003, tau: clamp(0.9 - (note - 48) / 120, 0.35, 0.9), r: 0.08,
        });
        case 'musicbox': return this.voice(dest, t, dur, {
          oscs: [['sine', 1, 0.6, 0], ['sine', 3, 0.1, 0], ['sine', 5.4, 0.04, 0], ['sine', 8.1, 0.02, 0]], f, gain: 0.45 * v,
          filter: [6000, 6000, 0], a: 0.002, tau: clamp(2 - (note - 60) / 50, 0.5, 2), r: 0.3,
        });
        case 'flute': return this.voice(dest, t, dur, {
          oscs: [['sine', 1, 0.55, 0], ['triangle', 1, 0.15, 0], ['sine', 2, 0.05, 0]], f, gain: 0.5 * v,
          filter: [2800, 2800, 0], a: 0.06, d: 0.12, s: 0.85, r: 0.14, vibrato: [5.5, 6, 0.3],
        });
        case 'synth': return this.voice(dest, t, dur, {
          oscs: [['sawtooth', 1, 0.28, -7], ['sawtooth', 1, 0.28, 7], ['square', 0.5, 0.08, 0]], f, gain: 0.4 * v,
          filter: [1400 + v * 2200, 900, 0.3], a: 0.01, d: 0.25, s: 0.7, r: 0.15,
        });
        case 'strings': return this.voice(dest, t, dur, {
          oscs: [['sawtooth', 1, 0.16, -8], ['sawtooth', 1, 0.16, 0], ['sawtooth', 1, 0.16, 8]], f, gain: 0.45 * v,
          filter: [1500, 1500, 0], a: 0.15, d: 0.3, s: 0.9, r: 0.45, vibrato: [5, 5, 0.4],
        });
        case 'pad': return this.voice(dest, t, dur, {
          oscs: [['sawtooth', 1, 0.14, -9], ['sawtooth', 1, 0.14, 9], ['triangle', 2, 0.08, 0]], f, gain: 0.4 * v,
          filter: [900, 900, 0], a: 0.4, d: 0.5, s: 1, r: 0.7,
        });
        case 'bass': return this.voice(dest, t, dur, {
          oscs: [['sine', 1, 0.6, 0], ['triangle', 1, 0.35, 0], ['sawtooth', 1, 0.06, 0]], f, gain: 0.7 * v,
          filter: [520 + v * 300, 260, 0.4], a: 0.008, d: 0.18, s: 0.75, r: 0.08, tau: 1.1,
        });
        default: return this.voice(dest, t, dur, { oscs: [['triangle', 1, 0.5, 0]], f, gain: 0.5 * v, filter: [3000, 3000, 0], a: 0.01, d: 0.2, s: 0.7, r: 0.1 });
      }
    }

    // 通用聲部：幾個振盪器 → 低通濾波（有自己的衰減）→ 音量包絡
    // tau 有給的話是「彈撥型」：不管音長多長，音量都以 tau 為時間常數衰減；音結束時再收掉。
    voice(dest, t, dur, p) {
      const ctx = this.ctx;
      const end = t + Math.max(0.03, dur);
      const stopAt = end + p.r + 0.05;
      const amp = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.7;
      filt.frequency.setValueAtTime(p.filter[0], t);
      if (p.filter[2] > 0) filt.frequency.setTargetAtTime(p.filter[1], t + 0.01, p.filter[2]);
      filt.connect(amp);
      amp.connect(dest);

      const g = amp.gain;
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(p.gain, t + p.a);
      if (p.tau) {
        g.setTargetAtTime(0.0001, t + p.a, p.tau);
      } else {
        g.setTargetAtTime(p.gain * p.s, t + p.a, p.d / 3);
      }
      g.setTargetAtTime(0.0001, end, p.r / 3);

      let lfo = null, lfoGain = null;
      if (p.vibrato) {
        lfo = ctx.createOscillator();
        lfo.frequency.value = p.vibrato[0];
        lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(0, t);
        lfoGain.gain.linearRampToValueAtTime(p.vibrato[1], t + p.vibrato[2]);
        lfo.connect(lfoGain);
        lfo.start(t);
        lfo.stop(stopAt);
      }
      for (const [type, ratio, gain, detune] of p.oscs) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = p.f * ratio;
        o.detune.value = detune;
        if (lfoGain) lfoGain.connect(o.detune);
        const og = ctx.createGain();
        og.gain.value = gain;
        o.connect(og);
        og.connect(filt);
        o.start(t);
        o.stop(stopAt);
      }
    }

    noiseBurst(dest, t, len, gain, filter, tau, attack) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter[0]; f.frequency.value = filter[1]; f.Q.value = filter[2] || 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + (attack || 0.002));
      g.gain.setTargetAtTime(0.0001, t + (attack || 0.002), tau);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t); src.stop(t + len);
    }
    tone(dest, t, type, f0, f1, gain, tau, len) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.setTargetAtTime(0.0001, t + 0.005, tau);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + len);
    }
    drum(note, t, vel, dest) {
      const v = clamp(vel, 0, 1);
      if (DRUM_PAN[note] && this.ctx.createStereoPanner) {
        const key = note + ':' + (dest === this.master ? 'm' : 'd');
        if (!this.drumPans[key]) { const p = this.ctx.createStereoPanner(); p.pan.value = DRUM_PAN[note]; p.connect(dest); this.drumPans[key] = p; }
        dest = this.drumPans[key];
      }
      switch (note) {
        case 36: this.tone(dest, t, 'sine', 170, 48, 0.95 * v, 0.13, 0.5); this.noiseBurst(dest, t, 0.03, 0.25 * v, ['lowpass', 2500, 0.5], 0.008); break;
        case 38: this.noiseBurst(dest, t, 0.35, 0.5 * v, ['bandpass', 1700, 0.7], 0.07); this.tone(dest, t, 'triangle', 200, 170, 0.35 * v, 0.05, 0.25); break;
        case 37: this.noiseBurst(dest, t, 0.08, 0.3 * v, ['bandpass', 2800, 2], 0.012); this.tone(dest, t, 'triangle', 900, 900, 0.25 * v, 0.018, 0.1); break;
        case 39: [0, 0.011, 0.022].forEach((d) => this.noiseBurst(dest, t + d, 0.06, 0.4 * v, ['bandpass', 1300, 1.4], 0.012)); this.noiseBurst(dest, t + 0.033, 0.3, 0.35 * v, ['bandpass', 1300, 1.4], 0.09); break;
        case 42: this.noiseBurst(dest, t, 0.12, 0.28 * v, ['highpass', 7500, 0.7], 0.025); break;
        case 46: this.noiseBurst(dest, t, 0.5, 0.28 * v, ['highpass', 7000, 0.7], 0.16); break;
        case 70: this.noiseBurst(dest, t, 0.12, 0.16 * v, ['bandpass', 5500, 1.2], 0.045, 0.012); break;
        case 54: this.noiseBurst(dest, t, 0.25, 0.22 * v, ['highpass', 6000, 0.7], 0.07); this.tone(dest, t, 'square', 4200, 4200, 0.03 * v, 0.03, 0.1); break;
        case 49: this.noiseBurst(dest, t, 1.6, 0.35 * v, ['highpass', 4000, 0.5], 0.5); break;
        case 51: this.noiseBurst(dest, t, 0.6, 0.18 * v, ['highpass', 6500, 0.7], 0.22); this.tone(dest, t, 'sine', 3100, 3100, 0.05 * v, 0.2, 0.5); break;
        default: this.noiseBurst(dest, t, 0.1, 0.2 * v, ['bandpass', 2000, 1], 0.03);
      }
    }
  }

  // 把整首排好的曲子在給定的 AudioContext 上排程（播放和離線輸出共用）
  // mix = { tracks: { lead: {volume, pan, tone, reverb, mute}, ... }, master: 'natural' }；沒給的欄位用編曲的預設
  function trackParams(tr, mix) { return Object.assign({}, tr.mix, mix && mix.tracks && mix.tracks[tr.id]); }

  function scheduleAll(synth, arr, startTime, mix, only) {
    const spb = 60 / arr.tempo;
    synth.setMaster(mix && mix.master);
    for (const tr of arr.tracks) {
      const p = trackParams(tr, mix);
      if (only ? tr.id !== only : p.mute) continue;
      if (only) p.mute = false;
      const dest = synth.track(tr.id, p);
      for (const e of tr.events) synth.play(tr.inst, e.note, startTime + e.t * spb + (e.off || 0), e.dur * spb, e.vel, dest);
    }
  }

  async function renderWav(arr, mix, only) {
    const spb = 60 / arr.tempo;
    const rate = 44100;
    const seconds = arr.totalBeats * spb + 2.5;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const synth = new Synth(ctx, { reverb: arr.reverb });
    scheduleAll(synth, arr, 0.05, mix, only);
    const buf = await ctx.startRendering();
    return encodeWav(buf);
  }

  // 分軌：每軌各自過同一條母帶鏈輸出一個 WAV
  async function renderStems(arr, mix, onProgress) {
    const out = [];
    for (let i = 0; i < arr.tracks.length; i++) {
      const tr = arr.tracks[i];
      if (onProgress) onProgress(tr, i, arr.tracks.length);
      out.push({ name: `${tr.id}-${tr.name}.wav`, data: await renderWav(arr, mix, tr.id) });
    }
    return out;
  }

  function encodeWav(buf) {
    const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true);
    data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const s = clamp(chans[c][i], -1, 1);
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
    return new Uint8Array(data.buffer);
  }

  // 最陽春的 zip（不壓縮）：artifact 檢視器只准存 .zip 之類的副檔名，.mid/.wav 要包起來
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) {
    const parts = [], central = [];
    let offset = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255];
    const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = Array.from(new TextEncoder().encode(f.name));
      const data = f.data;
      const crc = crc32(data);
      const head = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name];
      parts.push(new Uint8Array(head), data);
      central.push(...[0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]);
      offset += head.length + data.length;
    }
    const end = [0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(offset), ...u16(0)];
    const total = offset + central.length + end.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    out.set(central, o); o += central.length;
    out.set(end, o);
    return out;
  }

  // 把音符轉成簡譜顯示用的資訊
  function noteGlyph(note) {
    if (note.rest) return { text: '0', up: 0, down: 0 };
    const acc = note.acc > 0 ? '♯' : note.acc < 0 ? '♭' : '';
    return { text: acc + note.deg, up: Math.max(0, note.oct), down: Math.max(0, -note.oct) };
  }

  return {
    parseKey, keyName, parseChord, parseSong, harmonize, arrange, toMidi, midiOf, noteGlyph,
    Synth, scheduleAll, renderWav, renderStems, encodeWav, makeZip, trackParams,
    STYLES, STYLE_ALIASES, INSTRUMENTS, INSTRUMENT_ALIASES, LEAD_CHOICES, CHORD_CHOICES, BASS_CHOICES, PAD_CHOICES, LAYER_PATTERNS, DRUM_LABEL, DEFAULT_MIX, MASTER_PRESETS,
    resolveStyle, resolveInstrument,
  };
});
