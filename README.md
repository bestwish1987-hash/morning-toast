# 🍞 morning-toast

> 每天早上自動發一張 AI 生成的早安卡片到你的 LINE 群組。

由 Claude AI 寫禪意短句,從 Unsplash 抓「風景 / 插畫 / 可愛」三種風格輪流的底圖,合成成圖文卡片,推到 LINE 群組 — **完全免費**,每月成本不到 USD $0.30。

```
   ┌─────────────────────────────┐
   │                             │
   │   〈每天不同的背景圖〉        │
   │                             │
   │   靜心迎晨光                 │  ← Claude 生成的禪意標題
   │   ──                        │
   │   每一刻都是全新的開始        │
   │   放下昨日,輕盈前行          │
   │   願你今天心靜如水 🌿✨     │
   │                             │
   └─────────────────────────────┘
        ↑ 每天早上 7:00 自動發送
```

> 📷 部署成功後,歡迎把實際收到的圖片放到 `docs/screenshots/sample.png` 取代這段示意。

---

## ✨ 特色

- 🎲 **15 種隨機組合** — 3 圖片風格 × 5 文字風格,每天驚喜
- ✍️ **AI 即時寫詩** — Claude 每天生成不同的禪意短句,絕不重複
- 🖼️ **可下載可轉發** — 真實的圖檔(JPEG),不是 LINE 的 Flex Message
- ⏰ **完全免維護** — 部署一次,終身運作
- 🛠️ **完全可改** — 程式碼裡所有風格、prompt、版面都能改一行就生效

---

## 📚 文字風格(5 種,隨機輪替)

| 風格 | 範例語感 |
|---|---|
| 🧘 禪意正念 | 「靜心迎晨光 / 每一刻都是全新的開始」 |
| 💪 鼓勵打工人 | 「今天也辛苦了 / 一杯咖啡撐到午餐」 |
| 📜 文言文菜根譚 | 「晨光如鏡 / 心若止水,萬物自來」 |
| ✨ 文青 IG 風 | 「晨光是世界寫的詩 / 咖啡杯緣的霧氣」 |
| 🤗 溫暖長輩風 | 「早安,記得吃早餐 / 慢慢來不要急」 |

## 🎨 圖片風格(3 種,隨機輪替)

| 風格 | 範例題材 |
|---|---|
| 🏞️ 風景 | 京都櫻花、班夫湖、新疆草原 |
| 🎨 插畫 | 莫內睡蓮、梵谷星空、葛飾北齋浮世繪 |
| 🌸 可愛 | 粉嫩天空、櫻花瓣、熱氣球 |

---

# 🚀 部署方式(三條路,挑一條)

## 路 A:GitHub Actions(推薦 — 一次設定永遠不用管)

**適合**:第一次接觸自動化、想要長期使用、不想自己有電腦在跑、零成本最重要的人。
**優點**:免費、永遠運作、不佔你電腦資源。
**缺點**:第一次設定要 15 分鐘申請 4 個 API。

> 詳細步驟 → [跳到下方「路 A 步驟」](#路-a-步驟github-actions)

## 路 B:Render.com(像 GitHub Actions,但更彈性)

**適合**:想要除了排程之外、之後可能擴充網頁版的人。
**優點**:可以同時跑網頁服務、log 更清楚。
**缺點**:免費版會「冷啟動」(15 分鐘沒用會休眠,叫醒要等 30 秒)。

> 詳細步驟 → [跳到下方「路 B 步驟」](#路-b-步驟rendercom)

## 路 C:本機跑(不推薦,但有人會想試)

**適合**:電腦永遠開著、單純想試試看的人。
**優點**:資料完全在自己電腦上,不用申請雲端服務帳號。
**缺點**:電腦關了就不會發送、要自己設定 cron 排程。

> 詳細步驟 → [跳到下方「路 C 步驟」](#路-c-步驟本機跑)

---

# 📋 部署前準備(三條路都要)

不管走哪條路,**這 4 個 API 都要先申請**。每個都免費,跟著做即可。

> 📷 截圖待補 — 每個步驟我會描述要點什麼按鈕、看到什麼畫面。如果你卡住,提問或來信都可以。

## 1️⃣ LINE Messaging API(發訊息用)

### 1-1. 註冊 LINE Developers 帳號

打開 https://developers.line.biz/console → 用你的 LINE 帳號登入。

### 1-2. 建立 Provider(等於「公司/組織」名稱)

- 進入 Console 後,點 **Create a new provider**
- 名稱填什麼都可以(例如「個人」、你的名字)
- 按 Create

### 1-3. 建立 Channel(等於「機器人」)

- 點剛建好的 Provider
- 選 **Create a Messaging API channel**
- 填:
  - Channel name:你的機器人名字(例如「小早安」)
  - Channel description:隨便填
  - Category / Subcategory:隨便選一個
  - Email:你的 email
- 按 Create

### 1-4. 取得 Channel Access Token

- 進入剛建的 Channel
- 點上方 **Messaging API** 分頁
- 拉到最下面找 **Channel access token (long-lived)**
- 按 **Issue** → 跳出一長串字 → **複製保存**(這就是 `LINE_CHANNEL_ACCESS_TOKEN`)

### 1-5. 把機器人加進你的群組

- 還在同一個 Messaging API 分頁
- 找到 **QR code** → 用 LINE 掃 QR 加為好友
- 把這個好友**加進你想接收早安的 LINE 群組**

### 1-6. 取得群組 ID(需要技巧)

**這步比較難**,因為 LINE 不直接顯示群組 ID。三種方法:

**方法 1(推薦,最簡單):用 webhook 工具**

- 回到 Messaging API 分頁,找 **Webhook URL**
- 暫時設一個能接收訊息的 URL,例如:
  - 開 https://webhook.site/ → 自動產生一個 URL
  - 複製那個 URL 貼到 LINE Channel 的 Webhook URL
  - 啟用 Use webhook
- 在加了機器人的 LINE 群組裡**隨便發一句話**
- 回 webhook.site 看收到的 JSON,找 `"source": { "type": "group", "groupId": "Cxxxxxxxx..." }`
- 那個 `Cxxxxx...` 就是 `MORNING_GROUP_ID`(複製保存)
- 設定完後可以把 Webhook URL 清掉

**方法 2:用 LINE 官方「getGroupId」工具**
網路上有開源的小工具可以幫你抓,自己 google 「line bot get group id」找。

---

## 2️⃣ Anthropic Claude API(寫早安詩句)

- 打開 https://console.anthropic.com/ → 註冊
- 註冊完進 Console → 左側 **API Keys**
- 點 **Create Key** → 取個名字(例如「morning-toast」) → 建立
- 跳出一串以 `sk-ant-` 開頭的字 → **複製保存**(只會顯示一次!)→ 這就是 `ANTHROPIC_API_KEY`
- ⚠️ Claude API 要綁信用卡才能用 — 但**註冊送 $5 美金免費額度**,夠你跑 1 年以上(每天約 $0.01)

---

## 3️⃣ Unsplash(抓背景圖)

- 打開 https://unsplash.com/developers → 註冊(用 google 登入最快)
- 進 Dashboard → **Your applications** → **New Application**
- 同意條款 → 填基本資料(名稱、描述,隨意)
- 建好後在頁面上會看到 **Access Key** → **複製保存** → 這就是 `UNSPLASH_ACCESS_KEY`

---

## 4️⃣ Cloudinary(圖片託管,讓 LINE 能下載)

- 打開 https://cloudinary.com/ → 註冊(免費)
- 登入後 **Dashboard** 直接看到三個值:
  - **Cloud name** → `CLOUDINARY_CLOUD_NAME`
  - **API Key** → `CLOUDINARY_API_KEY`
  - **API Secret** → 點顯示 → `CLOUDINARY_API_SECRET`
- 全部複製保存

---

# 🛣️ 路 A 步驟:GitHub Actions

## A-1. 把 zip 變成你的 repo

**方式 A(推薦):從原作者 repo 直接 fork**

如果朋友把這個 repo 公開了,直接點他的 GitHub repo 右上角 **Fork** → **Create fork**,跳過下面 zip 上傳的步驟。

**方式 B:從 zip 自己建一個**

如果朋友只給你 zip:

1. 解壓 `morning-toast.zip` 到任意位置
2. 到 https://github.com/ 登入 → 右上角 **+** → **New repository**
3. Repository name 填 `morning-toast`,選 **Private**,**不要**勾選 Add README
4. 建好後頁面會給你指令,在解壓的資料夾打開命令提示字元:
   ```bash
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/你的帳號/morning-toast.git
   git push -u origin main
   ```
   (如果你沒安裝 git,先去 https://git-scm.com/ 下載安裝)

## A-2. 設定 GitHub Secrets(填入 7 個 key)

- 進入你的 repo
- 上方點 **Settings**
- 左側點 **Secrets and variables** → **Actions**
- 點 **New repository secret**,逐一新增以下 7 個:

| Name(必須一字不差) | 值 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟 1-4 拿到的 token |
| `MORNING_GROUP_ID` | 步驟 1-6 拿到的群組 ID(以 C 開頭) |
| `ANTHROPIC_API_KEY` | 步驟 2 拿到的 sk-ant-xxx |
| `UNSPLASH_ACCESS_KEY` | 步驟 3 拿到的 access key |
| `CLOUDINARY_CLOUD_NAME` | 步驟 4 拿到的 cloud name |
| `CLOUDINARY_API_KEY` | 步驟 4 拿到的 api key |
| `CLOUDINARY_API_SECRET` | 步驟 4 拿到的 api secret |

## A-3. 啟用 Actions

- 上方點 **Actions** 分頁
- 跳出 "Workflows aren't being run on this forked repository" 訊息
- 點綠色 **I understand my workflows, go ahead and enable them**

## A-4. 手動跑一次測試

- 左側點 **每日早安訊息**
- 右上角點 **Run workflow** → 直接點綠色 **Run workflow**(branch 用 main)
- 等 1-2 分鐘 → LINE 群組收到第一張卡片 🎉

## A-5. 完成!

之後每天**台灣時間 07:00** 自動發送,完全不用管。

> 如果發送失敗,點失敗的 workflow run 進去看 log 找錯誤訊息,通常是某個 key 填錯了。

---

# 🛣️ 路 B 步驟:Render.com

> 路 B 需要不同的程式碼結構(要有 Express server),目前 zip 是給路 A / C 用的。如果想走路 B,先用路 A 跑成功後,再聯絡原作者或自己改造。

---

# 🛣️ 路 C 步驟:本機跑

## C-1. 安裝 Node.js

- 打開 https://nodejs.org/
- 下載 **LTS** 版本(目前是 20.x)
- 安裝完打開**命令提示字元 / Terminal**,輸入:
  ```
  node -v
  npm -v
  ```
- 應該顯示版本號 → 安裝成功

## C-2. 解壓本專案 zip

- 把 `morning-toast.zip` 解壓到你想放的位置(例如桌面)
- 進入資料夾 `morning-toast/`

## C-3. 安裝依賴

打開命令提示字元,cd 到 morning-toast 資料夾,執行:

```bash
npm install
```

等 3-5 分鐘。

> ⚠️ **Windows 用戶可能遇到 `canvas` 套件編譯失敗** — 因為它需要 Cairo 圖形函式庫。如果失敗,建議改用路 A(GitHub Actions),它的環境已經預裝這些。

## C-4. 設定環境變數

在 morning-toast 資料夾根目錄建立一個檔案叫 **`.env`**(注意是點開頭),內容照 `.env.example` 填,但換成你的真實值:

```
LINE_CHANNEL_ACCESS_TOKEN=你的_token
MORNING_GROUP_ID=Cxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx
UNSPLASH_ACCESS_KEY=你的_unsplash_key
CLOUDINARY_CLOUD_NAME=你的_cloud_name
CLOUDINARY_API_KEY=你的_cloudinary_key
CLOUDINARY_API_SECRET=你的_cloudinary_secret
```

## C-5. 跑一次測試

```bash
node send.js
```

成功的話會看到一連串 log,結尾「✅ 發送成功」,LINE 群組會收到卡片。

## C-6. 設定排程(讓它每天自動跑)

本機排程比較麻煩,選一個:

**選項 1:Windows 工作排程器**

打開「工作排程器」 → 建立基本工作 → 觸發程序「每天 07:00」→ 動作「啟動程式」→ 程式輸入 `node`,引數輸入 `C:\path\to\morning-toast\send.js`

**選項 2:Mac / Linux crontab**

```bash
crontab -e
# 加入這行
0 7 * * * cd /path/to/morning-toast && /usr/local/bin/node send.js
```

**選項 3:node-cron 常駐程式**(電腦要永遠開著)
建一個 `daily.js`:

```js
const cron = require('node-cron');
const { exec } = require('child_process');

cron.schedule('0 7 * * *', () => {
  exec('node send.js', (err, stdout) => {
    console.log(stdout);
    if (err) console.error(err);
  });
}, { timezone: 'Asia/Taipei' });

console.log('排程已啟動');
```

需要 `npm install node-cron`,然後 `node daily.js`,**這個視窗要永遠開著**。

---

# 🎨 客製化

不管走哪條路,改設定都是改 `send.js` 這個檔案。

## 改發送時間(只適用路 A)

打開 `.github/workflows/morning.yml`:

```yaml
schedule:
  - cron: '0 23 * * *'  # UTC 23:00 = 台灣時間 07:00
```

cron 表達式用 [crontab.guru](https://crontab.guru/) 算 — **記得用 UTC 時間**,台灣是 UTC+8 要減 8 小時。

## 改文字風格

打開 `send.js` 找 `TEXT_STYLES`:

```js
const TEXT_STYLES = {
  zen: {
    label: '🧘 禪意正念',
    prompt: '充滿禪意、正念、正向...',  // ← 改這裡
  },
  // ...
};
```

要新增風格,自己 copy 一個區塊加進去:

```js
catlover: {
  label: '🐱 貓奴專屬',
  prompt: '從養貓人的角度寫早安...',
},
```

## 改圖片風格的關鍵字

打開 `send.js` 找 `STYLES`:

```js
const STYLES = {
  scenery: {
    keywords: [
      'cherry blossom field japan',  // ← 加自己想要的英文關鍵字
      // ...
    ],
  },
};
```

---

# 🐛 常見問題

**Q: 圖片中的中文變成方框?**
A: 字型沒裝。檢查 `.github/workflows/morning.yml` 有沒有 `fonts-noto-cjk`。

**Q: Claude 回傳的 JSON 解析失敗?**
A: 偶爾 Claude 多嘴會用 markdown 包 JSON。程式有處理,但仍可能失敗 — 重跑一次通常就好。

**Q: 我用 Claude API 額度跑完了?**
A: 改用 `claude-haiku-4-5` 模型(便宜 10 倍)。在 `send.js` 找 `model: 'claude-opus-4-5'` 改成 `model: 'claude-haiku-4-5-20251001'`。

**Q: 想發給多個群組?**
A: 目前是單群組。在 `send.js` 的 `sendToLine` 函式裡迴圈呼叫,或新增 `MORNING_GROUP_ID_2` 等 secret。

**Q: 為什麼有時候抽到的插畫不好看?**
A: Unsplash 是攝影圖庫,所謂「插畫」其實是「拍別人畫作的照片」,品質不穩。可以改 `send.js` 的 `STYLES.illustration.keywords` 換更穩的關鍵字。

---

# 💸 真實花費(路 A 為例)

| 服務 | 每天用量 | 每月費用 |
|---|---|---|
| Claude API | 1 次 / ~500 tokens | ~ USD $0.30 |
| Unsplash | 1 次 API 呼叫 | $0 |
| Cloudinary | 1 張 ~200KB 圖 | $0 |
| LINE Push | 1 則訊息 | $0(每月 200 則內) |
| GitHub Actions | ~1 分鐘 / 次 | $0(每月 2000 分鐘) |
| **合計** | | **USD $0.30/月** |

---

# 📜 授權

[MIT](LICENSE) — 隨便用、隨便改、隨便發布,不用問。

如果覺得這個專案有幫助,給個 ⭐ 是最大的鼓勵!

---

# 🙏 致謝

- [Anthropic Claude](https://www.anthropic.com/) — 每天寫禪意短句的 AI
- [Unsplash](https://unsplash.com/) — 免費高品質圖庫
- [Cloudinary](https://cloudinary.com/) — 圖片託管
- [node-canvas](https://github.com/Automattic/node-canvas) — 後端 Canvas 繪圖
- [Noto Sans CJK](https://fonts.google.com/noto) — Google 開源中文字型
