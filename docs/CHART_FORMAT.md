# 譜面格式與歌曲接入

## 第一首正式對戰曲

| 項目 | 值 |
|---|---|
| 顯示名稱 | Brand New Universe - Mobius |
| 歌曲 ID | `mobius-boss-01` |
| 原始檔 | `Brand New Universe - Mobius Materials/Brand_New_Universe-Mobius(Music).mp3`（未修改） |
| 遊戲用複本 | `public/audio/songs/mobius-boss-01.mp3`（MD5 `1bb3609ae47637bac251a792a6a68664`，與原檔相同） |
| 譜面 | `public/songs/mobius-boss-01/chart.json`（由 `scripts/generate-chart.mjs` 產生） |
| 時長 | 56.89 秒；44.1 kHz 立體聲；320 kbps |
| BPM | **125.0**（分析值；每拍 0.48 秒，4/4 拍，每小節 1.92 秒） |
| 第一拍偏移 | **0.310 秒**（前導靜音約 0.29 秒） |
| 拍速漂移 | 沒有。四段分析的相位都在 0.310–0.314 秒 |
| 分析方法 | `scripts/analyze-beats.py`：librosa beat_track，加上 hop 128 的 onset 相位搜尋。125 BPM 的相位分數是 4.45，其他 BPM 約 1.4 |

段落（小節 k 從 `0.31 + 1.92k` 秒開始）：

| 小節 | 秒數 | 段落 |
|---|---|---|
| 0–1 | 0.31–4.15 | 前奏（Boss 進場，不出音符） |
| 2–5 | 4.15–11.83 | Verse |
| 6–11 | 11.83–23.35 | Verse 2（雙手重音、重型彈） |
| 12 | 23.35–25.27 | Build |
| 13–26 | 25.27–52.15 | Chorus（集束彈、雙手） |
| 27–28 | 52.15–55.99 | Outro |

各難度節奏事件數（v0.22，整排算一個）：Easy 54（含 3 排扇形光網）、Normal 97（4 排）、Hard 126（5 排）。投擲飛行時間：Easy 2.5 秒、Normal 2.05 秒、Hard 1.7 秒。

### 偏移的調整
- **譜面偏移**（`timing.offsetSec`）：歌曲本身的第一拍位置。要修改就改 `scripts/generate-chart.mjs`，再執行 `npm run chart`。
- **玩家偏移**（設定 → 音訊／輸入偏移，`offsetMs`）：補償裝置與手勢的延遲。正值代表判定變晚。可以用選歌畫面的「校正」量測（8 拍，取中位數）。
- 音訊延遲已用 `AudioContext.getOutputTimestamp()` 或 `outputLatency` 自動補償。

## 格式 v1

```jsonc
{
  "format": "mobius-chart", "version": 1,
  "song": { "id": "mobius-boss-01", "title": "...", "artist": "...",
            "audio": { "src": "audio/songs/mobius-boss-01.mp3", "originalName": "..." }, // 匯入的歌曲改用 storeKey
            "durationSec": 56.89 },
  "timing": { "bpm": 125, "offsetSec": 0.31, "beatsPerBar": 4,
              "tempoMap": [ { "beat": 0, "bpm": 125 } ] },   // 變速歌曲可以加更多節點
  "difficulties": {
    "normal": { "travelSec": 2.05, "events": [
      { "id": "n0", "beat": 8, "type": "pumpkin", "hand": "R", "lane": { "x": 0.75, "y": 0.3 } },
      { "id": "n40", "beat": 52, "type": "cluster", "hand": "any", "lane": { "x": -0.2, "y": 0.5 }, "group": "c40" },
      { "id": "n31", "beat": 46, "type": "heavy", "hand": "any", "lane": { "x": 0, "y": 0.55 } }
    ] }
  }
}
```

- **事件時間** = `offsetSec` 加上依 `tempoMap` 換算的 `beat` 秒數。單一事件也可以用 `timeSec` 直接覆寫。程式不會假設第 0 秒是第一拍。
- `type`：
  - `pumpkin`：光網或炸彈都可以處理。
  - `cluster`：同拍的一群，適合藍光炸彈。
  - `heavy`：只能用藍光炸彈。
  - （v0.22）`fan_web_row`：同一拍、三條軌道各一顆普通南瓜，只能用雙手「扇形光網」一次擊破。欄位：`hand: "both"`、`tracks: [0,1,2]`、`cue: "fan"`、`practice`（選填，true = 練習排：漏接不扣護盾、不斷連擊）。執行時展開成三顆成員（id `<排id>.0/.1/.2`、`type: "fanRow"`、`row: <排id>`），判定以整排為單位一次結算。單手光網與藍光炸彈不能鎖定成員。
    ```jsonc
    { "id": "f1", "beat": 52, "type": "fan_web_row", "hand": "both", "tracks": [0, 1, 2], "cue": "fan" }
    ```
    產生器 `addFanRows()` 會移除排前 1.5 拍、排後 1 拍內的其他事件，避免同時要求互相衝突的手勢。
- `hand`：`L`／`R` 代表指定的手才能用光網命中（接近圈的顏色：紫色是左手、青色是右手）。`any` 代表哪隻手都可以。
- （v0.16）**`track`**（選填）：`0` 左、`1` 中、`2` 右，指定炸彈走哪一條浮空軌道。沒寫時由 `lane.x` 推算：`x ≤ −0.6` 左、`x ≥ 0.6` 右、其餘中間；同一拍的多顆炸彈不會擠在同一條軌道（群組炸彈會分散到三條）。
- `lane.x` ∈ [-1, 1]：v0.16 起只用來推算軌道（見上）。`lane.y` ∈ [0, 1]：v0.16 起不再使用（軌道高度由設定 `arcadeLaneHeight` 決定，會依玩家身高縮放）。
- 時間基準：**炸彈抵達判定環的時間** = `offsetSec` + 拍點時間（tempo map）+ 設定 `offsetMs`。炸彈在「抵達時間 − 飛行時間」從綠狂魔手中出現，位置完全由音樂時鐘計算（暫停／恢復不會漂移）。飛行時間 = 各難度的 `travelSec`，設定 `arcadeTravelSec` > 0 時覆蓋。
- Boss 會在 `time − travelSec − 0.3 s` 開始投擲動作，炸彈在 `time − travelSec` 離手，**剛好在指定節拍抵達攔截點**（玩家前方 4.2 m）。

## 判定規則
- **空間**：瞄準輔助只決定有沒有打中。命中區是目標投影寬高每邊外擴 10%，也就是 120%。從射線原點投影，左右眼的結果一致。
- **時間**：輸入當下的音訊時間減去音符時間。|dt| ≤ 75 ms 為 Perfect（完美），≤ 160 ms 為 Good（良好），超過就是 Miss（失誤）。數值可在開發面板調整。
- 光網以發射瞬間判定，光束只是約 60 ms 的視覺傳播，所以距離不影響公平性。
- 藍光炸彈以**釋放瞬間**判定。釋放時就鎖定主目標，以及 1.15 m 內同樣在判定窗內的目標，每個事件各判定一次。之後炸彈才飛過去引爆，所以玩家不需要自己估算提前量。用炸彈處理一般南瓜彈只拿 50% 分數，避免亂丟取代節奏操作。
- 過早出手會顯示「太早」，不影響音符。無效、過早或換錯手的射擊在 1.6 秒內累積 5 次，就會「過熱」1.2 秒。
- Miss 扣護盾 8（重型彈加權）。護盾歸零就失敗，除非開啟「不會失敗模式」。

## 裝甲南瓜彈（v0.48，`armored`）
一個事件開始一段序列，固定在中間那條軌道：

    { "id": "a0", "beat": 43, "type": "armored", "hand": "both", "hits": 3, "gap": 2 }

- `beat`：**第一個破甲拍**。裝甲南瓜彈會在前一拍（`beat − 1`）飛到中間的判定圈停住。
- `hits`：破甲拍的數量（預設 3，可省略），一拍一個：`beat`、`beat + 1`、`beat + 2`。每一拍在 Good 判定窗內用任一隻手的光網打中，剝掉一層；沒打中那一層就留著（不會長回來）。每個破甲拍算一個節奏事件。
- `gap`：最後一個破甲拍到**能量波拍**的拍數（預設 2；內建規則是 Easy／Normal 2 拍、Hard 1 拍）。能量波拍 = `beat + hits − 1 + gap`，算一個節奏事件，權重 3。
- 判定：三層都剝掉＋能量波準時 → 依時間判 Perfect／Good；還有裝甲 → 一樣打爆，最多 Good；沒有能量波 → Miss，它會衝向玩家爆炸。能量波以雙掌合併那一瞬間的時間判定（跟扇形光網一樣換算到音樂時鐘）。
- **空拍**：序列需要 8 拍空拍（能量波拍往前數 8 拍）。載入譜面時，這段時間內的其他事件會被拿掉；不要把 `fan_web_row` 排在裡面。
- 一局的第一顆是練習：有說明橫幅，沒打掉不扣分。
- **擺放規則**（`placeArmored`，`src/game/armored.js`；`scripts/generate-chart.mjs` 和遊戲內匯入都會用）：有段落資料時每首 3 顆：最後一顆的能量波落在最後一個音符上，另外兩顆放在段落結尾或長段落（8 小節以上）的中間，取最接近平均分布的位置；撞到扇形光網那一排就前後挪一兩個小節。沒有段落資料時大約每 32 小節一顆，加上結尾一顆。
- 開發設定「Armored pumpkins」（`settings.arcadeArmored`）關閉時，載入譜面會把 `armored` 事件拿掉、其他事件全部保留，所以事件數跟 v0.46 一樣。
- 手寫譜面時可以直接加這種事件；`validateChart` 會檢查 `hits`（1 到 6）和 `gap`（大於 0、最多 8 拍）。

## 接入新歌
1. **遊戲內匯入**（不需要寫程式）：主畫面 → 設定 → 歌曲 → 匯入。系統會自動分析 BPM 和第一拍，並產生三種難度的譜面，存在瀏覽器的 IndexedDB。分析信心不足時會提示手動輸入 BPM／偏移，按「套用並重建譜面」即可。如果瀏覽器清除了儲存資料，清單會提示你重新選擇檔案。
2. **作為內建歌曲**：
   1. 把音檔放到 `public/audio/songs/<id>.mp3`。
   2. 執行 `python3 scripts/analyze-beats.py <檔案>` 取得 BPM 和偏移。
   3. 複製 `scripts/generate-chart.mjs`，修改 song、timing 和 sections 後執行。
   4. 在 `src/core/songs.js` 的 `BUILTIN_SONGS` 加入一筆。
   5. 也可以手寫或手修 `chart.json`，載入時會用 `validateChart` 驗證。
- 只能使用你有授權的音樂。
