#!/usr/bin/env node
/* 把一份簡譜文字檔變成：可以直接播放的網頁（.html）+ MIDI 檔（.mid）
 *
 * 用法：
 *   node build.js <song.txt> [--out <資料夾>] [--name <檔名>] [--style <曲風>] [--lead <主奏>] [--check] [--json]
 *
 *   --check  只解析、配和弦、印摘要，不寫檔（先用這個看有沒有拍數錯誤）
 *   --json   把解析結果印成 JSON（除錯用）
 *   --style  覆蓋譜上的曲風：pop folk bossa rock musicbox kids waltz（中文別名也可以）
 *   --lead   覆蓋主奏樂器：piano epiano guitar flute musicbox synth strings
 *   --chords / --bass / --pad  換伴奏樂器（--pad none 關掉鋪底）；頁面上的混音台也能隨時換
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Band = require('./band.js');

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'check' || k === 'json' || k === 'help') args[k] = true;
      else args[k] = argv[++i];
    } else args._.push(a);
  }
  if (args.help || !args._[0]) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\*|\s\*\s?/gm, ''));
    process.exit(args.help ? 0 : 1);
  }

  const songPath = path.resolve(args._[0]);
  const text = fs.readFileSync(songPath, 'utf8');
  const song = Band.parseSong(text);
  Band.harmonize(song);
  const arr = Band.arrange(song, { style: args.style, lead: args.lead, instruments: { chords: args.chords, bass: args.bass, pad: args.pad } });

  const name = args.name || path.basename(songPath).replace(/\.[^.]+$/, '');
  const outDir = path.resolve(args.out || path.dirname(songPath));

  if (args.json) {
    console.log(JSON.stringify({ song, arrangement: { style: arr.style, lead: arr.lead, tempo: arr.tempo, tracks: arr.tracks.map((t) => ({ id: t.id, inst: t.inst, events: t.events.length })) } }, null, 2));
    return;
  }

  console.log(`曲名：${song.title || name}`);
  console.log(`調：${arr.keyName}　拍號：${song.meter.num}/${song.meter.den}　速度：${arr.tempo} BPM${song.tempo ? '' : '（曲風預設）'}`);
  console.log(`曲風：${Band.STYLES[arr.style].label} (${arr.style})　主奏：${Band.INSTRUMENTS[arr.lead].label} (${arr.lead})`);
  console.log(`伴奏：和弦 ${Band.INSTRUMENTS[arr.instruments.chords].label}、貝斯 ${Band.INSTRUMENTS[arr.instruments.bass].label}、鋪底 ${arr.instruments.pad ? Band.INSTRUMENTS[arr.instruments.pad].label : '無'}、鼓 ${Band.STYLES[arr.style].drums ? '有' : '無'}`);
  console.log(`小節：${song.bars.length}　總拍數：${song.totalBeats}`);
  console.log('和弦：' + song.bars.map((b) => b.chords.slice().sort((x, y) => x.beat - y.beat).map((c) => c.chord.symbol + (c.auto ? '' : '*')).join(' ')).join(' | '));
  if (song.bars.some((b) => b.chords.some((c) => !c.auto))) console.log('（* 是譜上指定的，其他是自動配的）');
  if (song.warnings.length) {
    console.log('\n提醒：');
    song.warnings.forEach((w) => console.log('  - ' + w));
  }
  if (!song.bars.length) { console.error('\n沒有讀到任何音符，請檢查譜的格式'); process.exit(2); }
  if (args.check) return;

  fs.mkdirSync(outDir, { recursive: true });
  const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'player.html'), 'utf8');
  const bandSrc = fs.readFileSync(path.join(__dirname, 'band.js'), 'utf8');
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  const title = song.title || name;
  const html = template
    .split('__TITLE__').join(escapeHtml(title))
    .replace('/*__BAND_JS__*/', () => safe(bandSrc))
    .replace('/*__SONG__*/""', () => safe(JSON.stringify(text)))
    .replace('/*__NAME__*/"song"', () => safe(JSON.stringify(name)));
  const htmlPath = path.join(outDir, `${name}.html`);
  const midiPath = path.join(outDir, `${name}.mid`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(midiPath, Band.toMidi(arr, song));
  console.log(`\n已輸出：\n  ${htmlPath}\n  ${midiPath}`);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

main(process.argv.slice(2));
