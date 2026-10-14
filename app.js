let currentWords = [];
let currentWordIndex = 0;
let isPlaying = false;
let isPaused = false;
let synth = window.speechSynthesis;

// ----------------------------------------------------
// Screen Wake Lock API 螢幕常亮控制模組
// ----------------------------------------------------
let wakeLock = null;

// 申請螢幕保持開啟
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock 已啟用：手機螢幕將保持開啟');
      
      // 監聽 Wake Lock 被系統強制釋放的事件
      wakeLock.addEventListener('release', () => {
        console.log('Screen Wake Lock 已被釋放');
      });
    } catch (err) {
      console.warn(`Wake Lock 申請失敗 (${err.name}: ${err.message})`);
    }
  } else {
    console.warn('目前瀏覽器/裝置不支援 Screen Wake Lock API');
  }
}

// 釋放螢幕常亮鎖定
async function releaseWakeLock() {
  if (wakeLock !== null) {
    try {
      await wakeLock.release();
      wakeLock = null;
      console.log('Screen Wake Lock 已主動釋放：恢復預設螢幕休眠');
    } catch (err) {
      console.error(`Wake Lock 釋放失敗: ${err.message}`);
    }
  }
}

// 當使用者切換分頁/回到 Safari 時，若仍在播放中則重新申請鎖定
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
// 語音朗讀核心邏輯
// ----------------------------------------------------
function speakText(text, lang = 'en-US', rate = 0.9) {
  return new Promise((resolve) => {
    if (!isPlaying) return resolve();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate; // 駕車跟讀適宜語速
    
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // 防止單一錯誤中斷播報流程
    
    synth.speak(utterance);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function playWordLoop() {
  // 開始播放時：申請 Screen Wake Lock 強制保持螢幕亮著
  await requestWakeLock();

  while (currentWordIndex < currentWords.length && isPlaying) {
    const item = currentWords[currentWordIndex];
    
    highlightRow(currentWordIndex);
    updateStatus(`正在朗讀 (${currentWordIndex + 1}/${currentWords.length}): ${item.word}`);

    // 1. 唸英文單字
    await speakText(item.word, 'en-US');
    await sleep(500);

    // 2. 唸中文單字定義
    await speakText(item.definition_tw, 'zh-TW');
    await sleep(500);

    // 3. 唸英文例句
    if (item.sentence_en) {
      await speakText(item.sentence_en, 'en-US');
      await sleep(500);
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
// 播放器控制按鈕（對外介面）
// ----------------------------------------------------
async function startAudioPlayer() {
  synth.cancel();
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
    // 暫停時釋放 Wake Lock 讓螢幕可依系統設定休眠
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
  // 停止播放時主動釋放 Screen Wake Lock
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
  // 自動取得畫面上選單目前選中的檔案路徑
  const selectElement = document.getElementById("lessonSelect");
  if (selectElement && selectElement.value) {
    loadLesson(selectElement.value);
  } else {
    loadLesson("data/lesson1.json"); // 預備預設值
  }
};
