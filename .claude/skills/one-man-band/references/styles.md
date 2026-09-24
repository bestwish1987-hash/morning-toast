# 曲風與樂器

## 七種曲風

| id | `曲風:` 可以寫 | 預設速度 | 主奏 | 和弦樂器 | 鼓 | 感覺 |
|---|---|---|---|---|---|---|
| `pop` | 流行、抒情、情歌、ballad | 84 | 鋼琴 | 鋼琴分解和弦 + 合成鋪底 | 有 | KTV 抒情歌的鋼琴伴奏 |
| `folk` | 民謠、吉他、acoustic | 96 | 長笛 | 吉他刷弦 | 輕（鼓邊 + 沙鈴） | 校園民謠 |
| `bossa` | bossa、波薩、爵士、慵懶 | 120 | 長笛 | 吉他切分 | 鼓邊 clave + 沙鈴 | 咖啡廳 |
| `rock` | 搖滾、樂團、熱血 | 120 | 合成器 | 吉他強力和弦八分音符 | 重 | 熱血 |
| `musicbox` | 八音盒、音樂盒、搖籃曲、療癒 | 76 | 八音盒 | 八音盒琶音 | 無 | 睡前 |
| `kids` | 兒歌、童謠、可愛、活潑 | 108 | 長笛 | 鋼琴「碰恰」 | 大鼓 + 拍手 + 沙鈴 | 幼兒園 |
| `waltz` | 華爾滋、圓舞曲、三拍 | 132 | 鋼琴 | 鋼琴「碰恰恰」+ 弦樂 | 輕 | 舞會 |

使用者口語對照：「溫柔、放鬆」→ pop 或 musicbox；「輕快」→ kids 或 folk；「有氣氛、咖啡廳」→ bossa；「熱鬧、有力」→ rock；「小朋友」→ kids；三拍子的譜沒指定 → waltz。

沒有定義該拍號的曲風（例如 bossa 配 3/4）會自動從 4 拍的版本截短，或退到最陽春的「一拍一下」，能播但沒那麼好聽；三拍子建議 waltz、pop、folk、kids、rock，6/8 建議 pop。

## 主奏樂器（`主奏:`）

鋼琴 piano、電鋼琴 epiano、吉他 guitar、長笛 flute（口哨、直笛也對到這個）、八音盒 musicbox（會高八度）、合成器 synth、弦樂 strings。
頁面上也能隨時換。

## 音軌

每首都會有：主旋律、和弦、貝斯、鼓（musicbox 沒有鼓）、鋪底（只有 pop、waltz）。頁面上每軌可以靜音、調音量；MIDI 匯出時各是一軌，鼓在第 10 通道。

## 想加新曲風

在 `scripts/band.js` 的 `STYLES` 加一個項目，再到 `STYLE_ALIASES` 加中文別名。格式：

```js
swing: {
  label: '搖擺', tempo: 140, lead: 'epiano', chord: 'piano', bass: 'bass', pad: null, drums: true, reverb: 0.2,
  patterns: {
    4: {
      // 每拍 4 格、一小節 16 格。X 重、x 中、g 輕、. 沒有。
      // 鼓的軌道：k 大鼓 s 小鼓 r 鼓邊 c 拍手 h hi-hat o 開鈸 m 沙鈴 t 鈴鼓 C 碎音鈸 R ride
      drums: { k: 'X.......X.......', R: 'x..x.x..x..x.x..', h: '....x.......x...' },
      // 貝斯：[格, 音, 長度(格)]；音：r 根音 5 五度 3 三度 o 高八度根音
      bass: [[0, 'r', 4], [4, '3', 4], [8, '5', 4], [12, 'o', 4]],
      // 和弦：type 是 block（齊奏）、arp（琶音：step 每幾格一個音、order 音的順序）、strum（刷弦，第三個值 d/u）、power（強力和弦）
      chord: { type: 'block', hits: [[2, 2], [6, 2], [10, 2], [14, 2]] },
    },
  },
},
```

`patterns` 也可以是函式 `(beats) => ({ drums, bass, chord })`，任何拍號都能用（musicbox 就是這樣寫）。

## 想改音色

`Synth.play()` 裡每種樂器是一組振盪器 + 低通濾波 + 包絡的參數（`oscs`、`filter`、`a`、`d`、`s`、`r`、`tau`）。
`tau` 有給就是彈撥類（音量自己衰減），沒給就是持續類（吹管、弦樂）。改完用 `node scripts/build.js examples/twinkle.txt --out /tmp/x` 重建，開網頁聽。
