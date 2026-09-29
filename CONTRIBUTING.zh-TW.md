# 參與貢獻

[English](CONTRIBUTING.md) | **繁體中文**

謝謝你幫忙！這個專案以學習為目的，清楚比聰明更重要。有問題或想法：[開一個 issue](https://github.com/BartonChenTW/grid-balancing-game/issues/new/choose)（中文或英文皆可），或寄信到 [barton.chen.energy@gmail.com](mailto:barton.chen.energy@gmail.com)。

## 從哪裡開始

- **挑一個想法。** [IDEAS.md](IDEAS.md) 列出可能的下一步，附上規模（S/M/L）與資料位置。規模 M 以上的項目，請先開 issue 討論做法。
- **回報問題或分享意見**，請使用 [issue 表單](https://github.com/BartonChenTW/grid-balancing-game/issues/new/choose)。
- **修改如何合併：** fork 這個 repository（或開一個 branch）、完成修改、執行下方的檢查，然後對 `main` 開 pull request。pull request 範本附有簡短的檢查清單，CI 會在每次推送時執行 `npm test` 與平衡報告。pull request 合併到 `main` 後，GitHub Pages 會發布遊戲。
- **AI 助理**（Claude Code 等）：[AGENTS.md](AGENTS.md) 整理了這些原則與指令。

## 基本原則

- **不需要建置步驟、沒有相依套件。** 只用可以直接當靜態檔案執行的 HTML、CSS 與 JavaScript 模組。
- **模擬保持純函式。** `js/sim.js`、`js/units.js`、`js/auto.js`、`js/fleet.js`、`js/score.js`、`js/economics.js` 與 `js/scenarios.js` 中的驗證程式，都是「輸入狀態、輸出狀態」，不碰 DOM，也不用 `Math.random`（請使用有種子的亂數產生器）。
- **不寫魔術數字。** 可調整的數值放在 `js/config.js` 或 `data/unit-types.json`。
- **所有介面文字放在 `js/strings.js`** 與其翻譯 `js/strings-zh-TW.js`，讓兩種語言都保持完整。
- **說明近似之處。** 簡化物理時，請加註解說明哪裡是近似。
- 送出修改前請執行 `npm test`。若更動資料或參數，也請執行 `node tools/balance-report.js`（以及 `easy`、`hard`），確認每個情境 × 每一天仍然可以過關。
- **排行榜分數會被重播。** 送出的分數會用當時的遊戲版本重播操作來驗證，因此任何改變一天玩法的修改（模擬、資料、計分）都需要新的版本號（見「發布新版本」）。`leaderboard/` 中的 Worker 在 `main` 上的 `worker.js`、`validate.js` 或 `migrations/` 變更時會自動重新部署（GitHub Actions）；資料庫變更請在 `leaderboard/migrations/` 新增一個檔案。請見 [leaderboard/DEPLOY.md](leaderboard/DEPLOY.md)。

## 新增或改進資料

最有價值的貢獻是**真實資料**。

- **每日曲線**（`data/days.json`，由 `tools/make-days.js` 產生）：負載曲線目前是示意資料，典型日（夏季與冬季的平日和週末、農曆春節、颱風天）的台電 10 分鐘系統負載實測資料可以取代它們。太陽光電與風力依台灣能源模型氣象年份中的真實日期（`data/weather-days.json`；要更換日期，請修改 `tools/import-weather.js`，以模型的 checkout 執行它，再執行 `tools/make-days.js`）。某一天也可以限電（`rationingPct`），並把某種燃料限制在其容量的一定比例（`fuelLimits`，例如液化天然氣封鎖日的 `{ "gas": 0.22 }`）。曲線長度可以是任何能整除 1440 的數字（24、48、96、144…）。`load` 是當日尖峰的比例，`peakRatio` 是當日尖峰佔年度尖峰的比例，`solar` 與 `wind` 是整體容量因數（0–1）。
- **情境**（`data/scenarios/*.json`）描述一個電源組合：每種技術一筆，包含總容量 `maxMW` 與相同機組的數量（`count`；儲能、水力、需量反應、太陽光電與風力都是一個單位）。也可以用 `unitList` 取代 `count`，列出真實機組的名稱與容量，例如 `[{ "name": "Taichung 1", "nameZh": "台中 1號機", "mw": 550 }]`；各機組容量加總必須等於 `maxMW`。風力可以提供 `offshoreShare`（離岸比例，0–1）供成本估算使用。請把檔案 id 加到 `data/scenarios/index.json`，並誠實填寫 `dataStatus`（`partial`、`placeholder`）、`dataNotes` 與 `sources`。

  ```json
  { "type": "coal", "maxMW": 19309, "count": 27 }
  { "type": "hydro", "maxMW": 2124, "energyMWh": 15000, "initialState": "online", "initialPct": 10 }
  { "type": "wind", "maxMW": 4517, "offshoreShare": 0.78 }
  ```
- **機組類型**（`data/unit-types.json`）：冷機起動時間（`startupMin`，到熱機備轉）與 `syncMin`（從熱機備轉到併聯；沒有熱機備轉的類型就省略）、停機分鐘數、升降載速度 %/分、最低穩定出力 %、慣量常數 H、每 MWh 燃料成本與 CO₂、`standbyCostPerMWh`、燃料類別 `fuel`、典型機組容量 `unitMW`、自動模式角色 `autoRole`，以及 `storage`、`energyLimited`、`activationLimited`、`variable`、`fastResponse`、`mustRun`、`restartable` 等旗標。
- **建造成本**（同樣在 `data/unit-types.json`）：`capexEURPerKW`、`lifeYears`；電池另有 `capexEURPerKWh` 與 `energyLifeYears`，風力另有 `capexOffshoreEURPerKW`。數值依循[台灣 PyPSA-Earth 電力模型](https://bartonchentw.github.io/pypsa-earth/)（technology-data 2030 年推估，2013 年歐元）。可選的 `capexSpreadPct` 可以讓某種技術有自己的不確定性，取代 `js/config.js` 中預設的 ±30%。

載入程式會驗證每個檔案，並指出哪個欄位有錯，所以最快的檢查方式就是開啟遊戲或執行 `npm test`。

### 事件

情境與日期都可以列出事件：

```json
{ "timeMin": 547, "type": "trip", "unitType": "gasCcgt", "namePrefix": "Hsinta", "lossMW": 2600, "note": "hsinta2022" }
{ "timeMin": 600, "type": "trip", "unitType": "gasCcgt", "units": 2 }
{ "timeMin": 780, "type": "clouds", "factor": 0.45, "durationMin": 50 }
{ "timeMin": 840, "type": "windCutout", "factor": 0.1, "durationMin": 480, "rampMin": 120, "warnMin": 240 }
{ "timeMin": 900, "type": "windLull", "factor": 0.35, "durationMin": 90 }
{ "timeMin": 960, "type": "demandSurge", "factor": 1.05, "durationMin": 120 }
```

跳機（trip）會讓 `unitType` 中運轉中的機組解聯：`units` 部，或直到失去 `lossMW` 為止。使用真實機組時，`namePrefix` 可以把跳機限定在某一座電廠。`note` 對應 `js/strings.js` 中的 `note.<id>` 文字。`warnMin` 會提前預告事件並把它納入預測。隨機意外的設定在 `js/config.js`（`events.random`）。

## 來自台灣能源模型的資料

有幾組資料來自[台灣能源模型](https://github.com/BartonChenTW/taiwan-energy-model)（TEM），模型記錄了每個數值的來源：

| 遊戲資料 | 來自 TEM | 如何更新 |
|---|---|---|
| 台灣 2025 的機組（`data/scenarios/taiwan-2025.json` 中的 `unitList`） | 台電機組清單 `data/official/taipower_units_*.json` 與 `data/taipower_plant_mapping.csv` | 依較新的快照手動修改機組清單；容量加總必須等於 `maxMW`。 |
| 台灣 2030 與 2050 電源組合 | `data/fleet/custom_powerplants_tw2030.csv`、`docs/data/sector_pathway.json`（情境 `official_imp`） | 修改情境檔，並同步更新 `dataNotes`。 |
| 每一天的日照與風力（`data/weather-days.json`） | 全年氣象模擬 `docs/data/cases/*.json` | `node tools/import-weather.js <TEM checkout>`，再執行 `node tools/make-days.js`。 |
| 液化天然氣封鎖日 | 能源安全分析 `docs/data/security/cases/` | 修改 `tools/make-days.js` 中的這一天。 |
| 燃料成本、碳排、建造成本 | `docs/data/model_data.json`（成本資料） | 修改 `data/unit-types.json`；其中的 `_comment` 說明每個數值。 |

## 翻譯

每種語言都是一張表，鍵值與 `js/strings.js` 中的 `en` 表相同；請參考 `js/strings-zh-TW.js`。新增一個檔案、在 `strings.js` 匯入，並登記到 `TABLES` 與 `LANGUAGES`。情境與日期的文字可以用 `scenario.<id>.name`、`scenario.<id>.description`、`scenario.<id>.dataNotes`、`day.<id>.name` 與 `day.<id>.description` 翻譯。缺少的鍵值會退回英文。

專案文件都是成對的：`README.md` / `README.zh-TW.md`、`CONTRIBUTING.md` / `CONTRIBUTING.zh-TW.md`、`CHANGELOG.md` / `CHANGELOG.zh-TW.md`。修改其中一份時，請兩份一起更新。

## 發布新版本

1. 更新 `js/version.js`（含發布日期）與 `package.json` 的版本號：新功能或新資料升次版號（0.X.0），修正升修訂號（0.0.X）。
2. 在 `CHANGELOG.md` 與 `CHANGELOG.zh-TW.md` 最上方新增一筆（`## X.Y.Z — YYYY-MM-DD`）；`npm test` 會檢查兩者是否一致。
3. 把 pull request 合併到 `main`。*tag release* 工作流程會把該提交標記為 `vX.Y.Z`（排行榜驗證程式會使用這些標籤；若缺少標籤，會改從 `main` 的歷史中尋找）。
4. 確認線上網站頁首顯示新版本。若 GitHub Pages 沒有重新建置，執行 `gh api -X POST repos/BartonChenTW/grid-balancing-game/pages/builds`。

## 在本機測試

```sh
npm start   # http://localhost:8000
npm test
```

在網址後面加上 `?demo`，讓腳本調度員（`tools/autopilot.js`）自動遊玩。
