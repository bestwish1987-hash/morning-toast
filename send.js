/**
 * 🍞 morning-toast - 早安訊息發送腳本(三風格隨機輪替版)
 * 流程:抽風格 → Claude 生文字 → Unsplash 取圖 → Canvas 合成 → Cloudinary → LINE
 *
 * 本機測試:複製 .env.example 為 .env 並填入真實 key,然後 node send.js
 * 雲端部署:用 GitHub Actions,把 key 填到 repo 的 Secrets
 */

// 本機開發載入 .env (GitHub Actions 環境會略過,沒裝 dotenv 也不會壞)
try { require('dotenv').config(); } catch (_) { /* dotenv 沒裝就算了 */ }

const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');
const cloudinary = require('cloudinary').v2;
const Anthropic = require('@anthropic-ai/sdk');

const GROUP_ID          = process.env.MORNING_GROUP_ID;
const LINE_TOKEN        = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CLAUDE_KEY        = process.env.ANTHROPIC_API_KEY;
const UNSPLASH_KEY      = process.env.UNSPLASH_ACCESS_KEY;
const CLOUDINARY_NAME   = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_KEY    = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_SECRET = process.env.CLOUDINARY_API_SECRET;

cloudinary.config({
  cloud_name: CLOUDINARY_NAME,
  api_key:    CLOUDINARY_KEY,
  api_secret: CLOUDINARY_SECRET,
});

const claude = new Anthropic({ apiKey: CLAUDE_KEY });

// ============================================================
//  註冊中文字型(必須,否則中文會變方框 hex)
// ============================================================
try {
  registerFont('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
               { family: 'NotoCJK' });
  console.log('✅ 字型註冊成功');
} catch (e) {
  console.warn('⚠️  字型註冊失敗,將使用系統 fallback:', e.message);
}

// ============================================================
//  三種風格定義
// ============================================================
const STYLES = {
  scenery: {
    label: '🏞️  風景',
    enhance: 'professional landscape photography golden hour',
    keywords: [
      'cherry blossom field japan',
      'misty mountain sunrise',
      'lavender field provence',
      'turquoise lake reflection',
      'autumn forest golden hour',
      'sunny tropical beach paradise',
      'iceland waterfall green',
      'tuscany rolling hills',
      'new zealand alpine meadow',
      'santorini blue dome sunset',
      'banff lake louise canada',
      'patagonia mountain glacier',
      'kyoto bamboo forest',
      'maldives overwater bungalow',
    ],
  },
  illustration: {
    label: '🎨 插畫',
    enhance: 'fine art museum painting masterpiece',
    keywords: [
      'monet impressionist water lilies',     // 莫內名作
      'van gogh starry night style',          // 梵谷風
      'hokusai great wave japanese',          // 葛飾北齋浮世繪
      'classical oil painting landscape gold frame', // 古典油畫
      'renaissance painting museum',          // 文藝復興
      'art nouveau alphonse mucha',           // 慕夏新藝術
      'turner romantic painting sunset',      // 透納
      'klimt golden painting',                // 克林姆
      'studio ghibli watercolor background',  // 吉卜力風背景
      'pixar concept art painting',           // 皮克斯概念畫
    ],
  },
  cute: {
    label: '🌸 可愛',
    enhance: 'soft pastel dreamy aesthetic high quality',
    keywords: [
      'pastel pink sky clouds dreamy',
      'soft cherry blossom petals close up',
      'pink sunset cotton candy clouds',
      'macaron pastel colors flatlay',
      'pastel hot air balloons sky',
      'rainbow pastel cloud sky',
      'sakura petals floating water',
      'pink peony flower close up',
      'cozy fairy lights bokeh',
      'lavender pastel field dreamy',
      'pastel beach sunrise pink',
      'soft tulip field colorful',
    ],
  },
};

function pickRandomStyle() {
  const styleKeys = Object.keys(STYLES);
  const picked = styleKeys[Math.floor(Math.random() * styleKeys.length)];
  return { key: picked, ...STYLES[picked] };
}

function pickRandomKeyword(style) {
  return style.keywords[Math.floor(Math.random() * style.keywords.length)];
}

// ============================================================
//  7 種文字風格(全繁體中文,每天隨機抽一種)
// ============================================================
const TEXT_STYLES = {
  zen: {
    label: '🧘 禪意正念',
    prompt: '充滿禪意、正念、正向,語言簡練像詩句,溫暖不說教。可參考《菜根譚》或日式俳句的留白美學。請務必全部用繁體中文,不要混入英文單字。',
  },
  worker: {
    label: '💪 鼓勵打工人',
    prompt: '像疲憊但體貼的朋友,鼓勵今天又要上班的人。可以提通勤、會議、薪水、週幾還沒到週五,溫暖但不矯情,有點懂打工人的辛酸。請務必全部用繁體中文,不要混入英文單字。',
  },
  classical: {
    label: '📜 文言文菜根譚',
    prompt: '文言文短句,典雅古樸,如《菜根譚》《圍爐夜話》《幽夢影》的清雋風格。用字精煉、有意境、有典故感,讀來如品茶。請務必全部用繁體中文,不要混入英文單字。',
  },
  literary: {
    label: '✨ 文青 IG 風',
    prompt: '像很厲害的 IG 早安文案,文青、有詩意、用意象說話而非直白勵志。例如「晨光是世界寫的詩」「咖啡杯緣的霧氣裡有今天的可能」。要有畫面感與文學性。請務必全部用繁體中文,不要混入英文單字。',
  },
  warm: {
    label: '🤗 溫暖長輩風',
    prompt: '像關心你的長輩,溫暖但不油膩、不說教。會叮嚀吃早餐、注意天氣、慢慢來不要急,讓人感覺被在乎。語氣自然,不要太多「孩子」「親愛的」這種稱呼。請務必全部用繁體中文,不要混入英文單字。',
  },
};

function pickRandomTextStyle() {
  const keys = Object.keys(TEXT_STYLES);
  const picked = keys[Math.floor(Math.random() * keys.length)];
  return { key: picked, ...TEXT_STYLES[picked] };
}

// ============================================================
//  Step 1:Claude 生成早安文字(依當日抽到的風格)
// ============================================================
async function generateMorningContent(textStyle) {
  const now = new Date();
  const today = now.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', timeZone: 'Asia/Taipei',
  });

  const response = await claude.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `今天是${today}。請用 JSON 格式輸出早安卡片內容,不要加任何說明或 markdown。

風格:${textStyle.prompt}

格式:
{
  "greeting": "早安標題(6字以內,符合上述風格)",
  "line1": "第一行(12字以內)",
  "line2": "第二行(12字以內)",
  "line3": "第三行(12字以內,可加emoji)"
}`
    }]
  });

  const raw = response.content[0].text.trim();
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ============================================================
//  Step 2:Unsplash 取圖
// ============================================================
async function getUnsplashImage(keyword, enhance) {
  const res = await axios.get('https://api.unsplash.com/photos/random', {
    params: {
      query: `${keyword} ${enhance}`,
      orientation: 'landscape',
      content_filter: 'high',
    },
    headers: { 'Authorization': `Client-ID ${UNSPLASH_KEY}` }
  });
  return res.data.urls.regular;
}

// ============================================================
//  Step 3:Canvas 合成圖片
// ============================================================
async function compositeImage(imageUrl, greeting, line1, line2, line3) {
  const W = 1200, H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 載入背景圖
  const img = await loadImage(imageUrl);
  ctx.drawImage(img, 0, 0, W, H);

  // 底部漸層遮罩
  const gradient = ctx.createLinearGradient(0, H * 0.5, 0, H);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.65)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // 標題
  ctx.fillStyle = '#FFE4A0';
  ctx.font = 'bold 64px "NotoCJK", sans-serif';
  ctx.fillText(greeting, 60, H - 220);

  // 分隔線
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(60, H - 195);
  ctx.lineTo(W - 60, H - 195);
  ctx.stroke();

  // 正文
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '40px "NotoCJK", sans-serif';
  ctx.fillText(line1, 60, H - 148);
  ctx.fillText(line2, 60, H - 96);

  ctx.fillStyle = '#FFE4A0';
  ctx.fillText(line3, 60, H - 44);

  return canvas.toBuffer('image/jpeg', { quality: 0.92 });
}

// ============================================================
//  Step 4:上傳到 Cloudinary
// ============================================================
async function uploadToCloudinary(imageBuffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'morning-bot', resource_type: 'image' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(imageBuffer);
  });
}

// ============================================================
//  Step 5:發送到 LINE
// ============================================================
async function sendToLine(imageUrl) {
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: GROUP_ID,
    messages: [{
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    }]
  }, {
    headers: {
      'Authorization': `Bearer ${LINE_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// ============================================================
//  主流程
// ============================================================
async function main() {
  console.log('🍞 morning-toast 開始準備早安訊息...');

  // 1. 隨機抽兩種風格
  const imgStyle = pickRandomStyle();
  const keyword = pickRandomKeyword(imgStyle);
  const textStyle = pickRandomTextStyle();
  console.log(`🎲 今日圖片風格:${imgStyle.label}`);
  console.log(`🔑 圖片關鍵字:${keyword}`);
  console.log(`✍️  今日文字風格:${textStyle.label}`);

  // 2. Claude 生文字(依當日抽到的文字風格)
  const content = await generateMorningContent(textStyle);
  console.log(`✅ 標題:${content.greeting}`);
  console.log(`   ${content.line1}`);
  console.log(`   ${content.line2}`);
  console.log(`   ${content.line3}`);

  // 3. Unsplash 取圖
  const imageUrl = await getUnsplashImage(keyword, imgStyle.enhance);
  console.log(`✅ 圖片取得`);

  // 4. Canvas 合成
  const buffer = await compositeImage(
    imageUrl,
    content.greeting,
    content.line1,
    content.line2,
    content.line3,
  );
  console.log(`✅ 圖片合成完成`);

  // 5. 上傳
  const uploadedUrl = await uploadToCloudinary(buffer);
  console.log(`✅ 上傳到 Cloudinary:${uploadedUrl}`);

  // 6. 發送
  await sendToLine(uploadedUrl);
  console.log('✅ 發送成功!可下載、可轉發 🎉');
}

main().catch(err => {
  console.error('❌ 失敗:', err.message);
  if (err.response) {
    console.error('Response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
