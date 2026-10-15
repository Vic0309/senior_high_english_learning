let currentWords = [];
let currentWordIndex = 0;
let isPlaying = false;
let isPaused = false;
let synth = window.speechSynthesis;

// ----------------------------------------------------
// Screen Wake Lock API 螢幕常亮控制模組
// ----------------------------------------------------
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn(`Wake Lock 申請失敗: ${err.message}`);
    }
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    try {
      await wakeLock.release();
      wakeLock = null;
    } catch (err) {
      console.error(`Wake Lock 釋放失敗: ${err.message}`);
    }
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && isPlaying) {
    await requestWakeLock();
  }
});

// ----------------------------------------------------
// 載入與渲染邏輯
// ----------------------------------------------------
async function loadLesson(jsonPath) {
  await stopAudioPlayer();
  try {
    const res = await fetch(jsonPath);
    const data = await res.json();
    currentWords = data.words;
    renderTable(data);
    renderGrammar(data.patterns);
  } catch (err) {
    console.error("載入課文失敗:", err);
  }
}

function renderTable(data) {
  const tbody = document.getElementById("wordList");
  tbody.innerHTML = "";
  
  data.words.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.id = `word-row-${index}`;
    tr.onclick = () => playFromIndex(index);
    
    tr.innerHTML = `
      <td>
        <strong>${item.word}</strong> <br>
        <small>${item.pos} ${item.kk}</small>
      </td>
      <td>
        <div><strong>英：</strong>${item.definition_en}</div>
        <div><strong>中：</strong>${item.definition_tw}</div>
      </td>
      <td>
        <div>${item.sentence_en}</div>
        <div style="color: #666; font-size: 0.9em;">${item.sentence_tw}</div>
      </td>
      <td>
        <div><strong>解析：</strong>${item.analysis}</div>
        <div><strong>時機：</strong>${item.timing}</div>
      </td>
      <td>
        <button onclick="event.stopPropagation(); playFromIndex(${index})">🔊 朗讀</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderGrammar(patterns) {
  const container = document.getElementById("grammarList");
  if (!container || !patterns) return;
  container.innerHTML = patterns.map(p => `
    <div class="grammar-card">
      <h3>${p.title}</h3>
      <p><strong>結構：</strong><code>${p.structure}</code></p>
      <p><strong>解析：</strong>${p.explanation}</p>
      <p><strong>例句：</strong>${p.sentence_en} (${p.sentence_tw})</p>
    </div>
  `).join('');
}

// ----------------------------------------------------
// iOS 專用穩定語音朗讀核心
// ----------------------------------------------------
function speakText(text, lang = 'en-US', rate = 0.9) {
  return new Promise((resolve) => {
    if (!isPlaying) return resolve();
    
    // 每次發聲前先取消殘餘語音，避免 iOS 語音佇列卡死
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    
    utterance.onend = () => {
      resolve();
    };
    utterance.onerror = (e) => {
      console.warn("Speech synthesis error:", e);
      resolve();
    };
    
    synth.speak(utterance);

    // [iOS Safari 救命機制]：
    // Safari 有時計時器會漏掉 onend 事件，加入安全超時機制確保流程能繼續
    const estimatedTime = (text.length * 150) + 1000; 
    let finished = false;
    const originalResolve = resolve;
    resolve = () => {
      if (!finished) {
        finished = true;
        originalResolve();
      }
    };
    setTimeout(resolve, Math.max(estimatedTime, 3000));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function playWordLoop() {
  await requestWakeLock();

  // [重要] iOS  Safari 喚醒音訊管線：
  // 首次播放前先執行一次極短的靜默解鎖，確保後續朗讀有聲音
  if (synth.speaking) synth.cancel();

  while (currentWordIndex < currentWords.length && isPlaying) {
    const item = currentWords[currentWordIndex];
    
    highlightRow(currentWordIndex);
    updateStatus(`正在朗讀 (${currentWordIndex + 1}/${currentWords.length}): ${item.word}`);

    // 1. 唸英文單字
    await speakText(item.word, 'en-US');
    await sleep(400);

    // 2. 唸中文單字定義
    await speakText(item.definition_tw, 'zh-TW');
    await sleep(400);

    // 3. 唸英文例句
    if (item.sentence_en) {
      await speakText(item.sentence_en, 'en-US');
      await sleep(400);
    }

    // 4. 唸中文深入解析與使用時機
    if (item.analysis) {
      await speakText("解析：" + item.analysis + "。使用時機：" + item.timing, 'zh-TW');
    }

    // 5. 留空 3.5 秒供跟讀與思考
    if (!isPlaying) break;
    updateStatus(`跟讀思考時間（3.5 秒）...`);
    await sleep(3500);

    if (!isPlaying) break;
    currentWordIndex++;
  }

  if (currentWordIndex >= currentWords.length && isPlaying) {
    updateStatus("所有單字已朗讀完畢！");
    await stopAudioPlayer();
  }
}

// ----------------------------------------------------
// 播放器控制按鈕
// ----------------------------------------------------
async function startAudioPlayer() {
  isPlaying = true;
  isPaused = false;
  currentWordIndex = 0;
  playWordLoop();
}

async function playFromIndex(index) {
  synth.cancel();
  isPlaying = true;
  isPaused = false;
  currentWordIndex = index;
  playWordLoop();
}

async function pauseAudioPlayer() {
  if (isPlaying) {
    synth.pause();
    isPlaying = false;
    isPaused = true;
    updateStatus("已暫停朗讀");
    await releaseWakeLock();
  }
}

async function resumeAudioPlayer() {
  if (isPaused) {
    synth.resume();
    isPlaying = true;
    isPaused = false;
    updateStatus("繼續朗讀...");
    await requestWakeLock();
  } else if (!isPlaying) {
    isPlaying = true;
    playWordLoop();
  }
}

async function stopAudioPlayer() {
  synth.cancel();
  isPlaying = false;
  isPaused = false;
  updateStatus("目前狀態：靜止");
  await releaseWakeLock();
}

function highlightRow(index) {
  document.querySelectorAll("#wordList tr").forEach(tr => tr.classList.remove("active-row"));
  const row = document.getElementById(`word-row-${index}`);
  if (row) {
    row.classList.add("active-row");
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function updateStatus(msg) {
  const elem = document.getElementById("statusText");
  if (elem) elem.innerText = "目前狀態：" + msg;
}

window.onload = () => {
  const selectElement = document.getElementById("lessonSelect");
  const initialPath = (selectElement && selectElement.value) ? selectElement.value : "data/lesson1.json";
  loadLesson(initialPath);
};
