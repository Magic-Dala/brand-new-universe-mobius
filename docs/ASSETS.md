# 資產來源與暫代素材

## 使用者提供（參考或正式）
| 檔案 | 用途 | 狀態 |
|---|---|---|
| Brand_New_Universe-Mobius(Music).mp3 | 第一首街機 Boss 對戰曲 | **正式**。複製到 `public/audio/songs/mobius-boss-01.mp3`，未修改 |
| Mobius_Three_View.png | 小莫造型 | 參考，已做成程序化模型 |
| Green_Maniac_Three_View.png | 綠狂魔造型 | 參考（正式模型改用下方 GLB；程序版只在 GLB 載入失敗時使用） |
| Green Bat Jet_Three_View.png | 綠魔飛行器 | 參考（正式模型改用下方 GLB） |
| Mobius_Home_Three_View.png | 房間配置 | 參考，已做成程序化房間 |
| Mobius_Home_to_City_Three_View.png | 城市與擺盪路線（v0.10 環形城市時代） | 參考（v0.20 起改用下面的達拉城三視圖） |
| 達拉城三視圖（2026-10 對話附件） | v0.20 紐約風格模組化城市的外觀、配色、建築類型 | 參考，已做成程序化城市（座標見 WORLD_COORDINATES.md） |
| Storyboard_16-panelgrid.png | 故事流程 | 參考，已做成故事狀態機 |
| Title_Home_Menu_Page.png | 主選單版面 | 參考，已做成 3D 房間背景加 DOM UI |
| Green_Maniac_3d_model_2k_rigged.glb（Tripo，含骨架，13 MB，19 萬三角形，2048² 貼圖） | 綠狂魔（v2，2026-10 取代舊版） | **正式**。最佳化為 `public/models/green_maniac.glb`：9.5 萬三角形、1024² WebP、頂點量化，2.6 MB。保留原檔的蒙皮權重：60 多個骨骼（含手指）在載入時合併到遊戲的簡化骨架（`src/art/bossModels.js` 的 `rigManiac`），所以騎乘、投擲、受擊、墜落等動作照舊；原骨架沒有尾巴骨，尾巴混合到 `tail` 骨做輕微擺動 |
| Pumpkin_Bomb_3d_model_2k.glb（Tripo，3.1 MB） | 普通南瓜炸彈（街機：普通／群組音符；故事：屋頂那顆倒數炸彈、接彈回投、十枚炸彈） | **正式**。最佳化為 `public/models/pumpkin_bomb.glb`：4,700 三角形、0.21 MB（貼圖 1024 / 512 webp）；正面數位顯示器朝向玩家；發光部分由底色貼圖自動產生自發光遮罩 |
| Giant_Pumpkin_Bomb_3d_model_2k.glb（Tripo，3.4 MB） | 巨型南瓜炸彈（街機：重型音符） | **正式**。最佳化為 `public/models/giant_pumpkin_bomb.glb`：9,700 三角形、0.31 MB；邪惡笑臉朝向玩家；遊戲中放大 1.65 倍 |
| Armored_Pumpkin/（Tripo，四個檔案：stage 0 armor、stage 1 cracked、stage 2 charred、stage 3 orb，共 39 MB） | 裝甲南瓜彈（街機：`armored` 音符，v0.48） | **正式**。合併為 `public/models/armored_pumpkin.glb`：四個節點 `stage_0`～`stage_3`（9,001／7,572／9,850／4,896 三角形），1.94 MB；一次只顯示一個階段（1 個 draw call）；綠色自發光貼圖已在檔案內；雙面材質。原始檔在 `3D_Models/Armored_Pumpkin/`，不要修改。規格：`docs/goals/v048-armored-pumpkin-decision.md` |
| factory_lightmap.webp（自製，Blender Cycles 烘焙） | 工廠室內光照貼圖（2048，第二組 UV） | **正式**。`tools/blender/bake_lightmap.py` 產生（約 2–3 分鐘 CPU），經 gltf-transform 最佳化；`factory_interior.glb` 含 TEXCOORD_1 |
| Green_Bat_Jet_3d_model_2k.glb（Tripo，9.1 MB，19 萬三角形） | 綠魔飛行器（v2，2026-10 取代舊版） | **正式**。最佳化為 `public/models/green_bat_jet.glb`：3 萬三角形、1024² WebP、頂點量化，0.92 MB。原檔機頭朝 +Z，載入時轉 180°；翼展 5.5 m；機身＋左右機翼骨架（拍翼、受損下垂）；噴焰位置對準機腹的兩具引擎（x ±0.33、y −0.34 m）；綠狂魔站在機背平台（約 0.53 m 高） |
| （同上兩個原檔，HD 版） | 工廠（街機＋故事頭目戰）用的高精度綠狂魔／飛行器 | **正式**。`public/models/green_maniac_hd.glb`：19 萬三角形（原檔全面數、保留骨架）、底色＋法線 2048 WebP、金屬粗糙度 1024，6.1 MB；`public/models/green_bat_jet_hd.glb`：9.1 萬三角形，同樣貼圖規格，2.3 MB。開機後在背景下載，進工廠的 Loading 畫面時換上；回城市換回一般版 |
| New_Mobius_3d_model_2k_rigged.glb（Tripo，含 Quaternius/ActionForge 骨架，9.4 MB，95k 三角形，3 張 2048² 貼圖） | 小莫角色模型 v2（2026-10 取代舊版）：房間展示架上的套裝、鏡中全身 | **正式**。最佳化為 `public/models/mobius.glb`：保留全部 95,275 三角形與骨架、移除未使用的動畫（consume）、底色＋法線 2048² WebP、金屬粗糙度 1024² WebP、頂點量化，3.1 MB。鏡中身體直接使用原檔的骨架位置與蒙皮權重（71 個骨骼合併到遊戲的 19 骨 IK 骨架，`src/art/mobiusModel.js`），不再自動綁骨。骨架與動畫標示 CC0（Quaternius） |
| Mobius_3d_model_textured.glb（Tripo，20.8 MB，431k 三角形，4 張 4096² 貼圖） | 小莫角色模型 v1（已被 v2 取代） | 舊版，不再使用。最佳化後放在 `public/models/mobius.glb`：51.7k 三角形、4 張 1024² WebP、頂點量化，1.57 MB（GPU 記憶體約 22 MB，原檔約 358 MB）。原檔沒有骨架，載入時自動綁定簡易人形骨架（`src/art/mobiusModel.js`）讓鏡中可以跟頭手動作 |

原始素材留在 `Brand New Universe - Mobius Materials/`，沒有被修改或覆寫。

## 暫代素材（全部由程式即時產生，沒有外部授權問題）
| 項目 | 實作 | 之後要換成 |
|---|---|---|
| 小莫裝甲手（25 關節） | `src/art/mobius.js` 程序幾何，卡通著色＋外框（鏡中全身與展示套裝已改用正式模型；模型載入失敗時才會退回程序版） | 有骨架的手部模型 |
| 綠狂魔（含尾巴擺動、投擲／受擊／蹲姿） | `src/art/enemies.js` | 有骨架的 glTF 和動畫 |
| 綠魔飛行器 | `src/art/enemies.js` | glTF |
| v0.27 招牌圖集（1024×512，16 個原創店名，含中文「達拉麵館」「咖啡」） | `src/art/cityArt.js` 用 canvas 即時繪製，字型使用系統字型；店名是原創，不是真實品牌 | — |
| v0.27 天際線剪影（2048×256） | `src/art/cityArt.js` 用 canvas 即時繪製（固定種子），取代 v0.20 的剪影 | — |
| v0.27 街道設施、雨棚、車輛、樹冠、人行道 | `src/art/cityArt.js` 用程序方式組合方塊、圓柱、二十面體（vertex color），沒有使用外部模型 | 之後可以換成自製的 Blender 模組化部件（固定公尺比例、簡化 LOD、烘焙 AO） |
| v0.25 城市噪聲貼圖（256² RGBA，可平鋪，含 mipmap，約 0.33 MiB） | `src/art/cityQuality.js` 以固定整數雜湊即時產生（不用外部素材、不用 Math.random），供牆面雨痕和汙漬、柏油、人行道使用 | 若之後改用 CC0 貼圖（Poly Haven、ambientCG），需記錄來源、授權、修改內容和日期 |
| 科技南瓜彈（含倒數顯示）、藍光炸彈 | `src/art/enemies.js` | glTF 和 VFX |
| 房間、天空、夕陽 | `room.js`、`sky.js`（畫布貼圖、合併幾何） | 美術場景 |
| **v0.20 達拉城全部建築與道具**：磚／石／玻璃立面（程序化 512² 紋理陣列 9 層）、退縮、窗戶燈光、水塔、逃生梯、屋頂設備、店面、路燈、行道樹、招牌支架、桅杆、街道（shader）、遠景與天際線 | `src/art/city.js`、`src/data/blocks.js`（全部程式產生，沒有外部素材） | 正式的模組化建築模型（可直接替換每種模組的 InstancedMesh） |
| 工廠鐵捲門破門版本、碎片、火花 | `src/art/factoryExterior.js`、`src/game/factoryFlow.js` | 正式模型與 VFX |
| 破門、推進器音效 | `src/core/audio.js` 合成（`doorBreak`、`thrust`） | 正式 SFX |
| 光網、網子、爆炸、判定字、接近圈 | `src/game/effects.js`（物件池） | 正式 VFX |
| **所有音效** | `src/core/audio.js` 用 Web Audio 即時合成 | 正式 SFX |
| **房間開場音樂** | 程序化 lo-fi 循環（暫代，和 Boss 對戰曲分開） | 正式開場曲 |
| **警用廣播配音** | 沒有配音，只有雙語字幕，畫面會標示「暫代：尚無正式配音」 | 正式中英配音 |
| UI 字型 | 系統字型（PingFang TC／Noto Sans TC／微軟正黑體） | 可再內嵌 Noto Sans TC 子集 |


## v0.30 新增素材（城市＋特效）
> 規則：只用 CC0 或原創（Blender 腳本程序建模、程式產生的貼圖）。**沒有複製、描摹或擷取任何商業遊戲的素材、貼圖或標誌**。

### CC0 PBR 材質（下載與打包：`tools/assets/fetch_cc0.py`）
| 檔案 | 來源素材 | 來源網址 | 授權 | 備註 |
|---|---|---|---|---|
| `public/textures/city/brick_red_albedo/_normal/_orm.webp` | polyhaven：red_brick | https://polyhaven.com/a/red_brick | CC0 1.0 | 512² WebP；陣列第 0 層 |
| `public/textures/city/brick_dark_albedo/_normal/_orm.webp` | polyhaven：brick_wall_02 | https://polyhaven.com/a/brick_wall_02 | CC0 1.0 | 512² WebP；陣列第 1 層 |
| `public/textures/city/brick_cream_albedo/_normal/_orm.webp` | polyhaven：sandstone_brick_wall_01 | https://polyhaven.com/a/sandstone_brick_wall_01 | CC0 1.0 | 512² WebP；陣列第 2 層 |
| `public/textures/city/limestone_albedo/_normal/_orm.webp` | polyhaven：white_sandstone_blocks_02 | https://polyhaven.com/a/white_sandstone_blocks_02 | CC0 1.0 | 512² WebP；陣列第 3 層 |
| `public/textures/city/concrete_albedo/_normal/_orm.webp` | polyhaven：brushed_concrete | https://polyhaven.com/a/brushed_concrete | CC0 1.0 | 512² WebP；陣列第 4 層 |
| `public/textures/city/asphalt_albedo/_normal/_orm.webp` | polyhaven：asphalt_02 | https://polyhaven.com/a/asphalt_02 | CC0 1.0 | 512² WebP；陣列第 5 層 |
| `public/textures/city/metal_albedo/_normal/_orm.webp` | polyhaven：metal_plate | https://polyhaven.com/a/metal_plate | CC0 1.0 | 512² WebP；陣列第 6 層 |
| `public/textures/city/paving_albedo/_normal/_orm.webp` | polyhaven：concrete_pavement | https://polyhaven.com/a/concrete_pavement | CC0 1.0 | 512² WebP；陣列第 7 層 |
| `public/textures/city/glass_grime_albedo/_normal/_orm.webp` | ambientcg：SurfaceImperfections003 | https://ambientcg.com/view?id=SurfaceImperfections003 | CC0 1.0 | 512² WebP；陣列第 8 層 |

- 原始下載檔（1K JPG／ARM）由腳本下載到 `art/cc0_src/` 只做打包用，不放進專案（重新執行腳本即可取得），也不會打包進遊戲。
- 授權說明：Poly Haven https://polyhaven.com/license 、ambientCG https://ambientcg.com/license （皆為 CC0 1.0）。
- **KTX2／Basis 沒有使用**：工具鏈裡沒有 Basis 編碼器（basisu），IWSDK 也沒有設定轉碼器，所以改用 WebP（下載小）；GPU 記憶體是一般 RGBA8，三個陣列合計約 36 MiB。

### 原創（程序產生）
| 檔案／產生器 | 用途 | 授權 |
|---|---|---|
| `public/models/city_kit.glb`＋`city_kit.json`（`tools/blender/build_city_kit.py`，Blender 5.2 bpy） | 模組化建築套件：45 件（窗框開間 ×3、壁柱、腰線、簷口 ×2、屋頂冠 ×3、逃生梯、隅石、裝飾藝術開間 ×3、退縮女兒牆、尖頂冠、玻璃帷幕開間、店面 ×4＋玻璃店面、屋頂設備 11 種、3 棟地標塔），每件有 LOD0／LOD1 與烘焙頂點 AO；816 KB | 原創 |
| 房間圖集（`src/art/cityMaterials.js` roomAtlas，canvas） | interior mapping 的 8 種房間後牆 | 原創 |
| 看板圖集（`src/art/cityMaterials.js` adsAtlas，canvas） | 屋頂看板 8 則**虛構品牌**廣告（DALA COLA、MOBIUS ENERGY 等） | 原創 |
| 天空反射立方體貼圖（執行時烘焙一次） | 玻璃反射夕陽天空 | 原創（由遊戲自己的天空 shader 產生） |
| 鄰棟陰影高度場（執行時產生） | 解析式鄰棟投影 | 原創（由城市資料產生） |

## v0.30 特效貼圖（全部自製、程序產生，沒有外部檔案，無授權問題）
開機時以 canvas 即時產生（`src/game/vfx/textures.js`），不使用 CC0 或任何外部素材。
| 貼圖 | 尺寸 | 內容 | 用途 |
|---|---|---|---|
| 特效圖集 `atlasTexture()` | 320²（2×2 格） | 柔光（白熱核心）、火花拉絲、四芒星閃光、六角格符號 | 加法粒子（火花、餘燼、閃光、藍色六角碎光） |
| 煙霧序列 `smokeFlipbook()` | 512²（4×4 格，16 格） | 區域扭曲的 fbm 噪聲煙團：R 密度、G 頂光陰影、B 細噪（侵蝕邊緣用） | 火球轉煙、煙柱、塵土、尾煙 |
| 六角網格 `hexTexture()` | 256×222（可平鋪） | 尖頂六角格線：R 線條、G 格心 | 光網光束紋理、扇形光網 |
| 南瓜鬼臉 `faceTexture()` | 256² | 三角眼、鼻、鋸齒笑口：R 模糊光暈、G 銳利遮罩 | 飛行中南瓜炸彈／巨型炸彈的發光鬼臉 |
| 風線 `windStreakTexture()` | 32×128 | 兩端漸隱的細長條（alphaMap） | 擺盪時的風線（v0.30 風格） |

## v0.31 工廠室內重建（`public/models/factory_v2/`）
> 規則同上：只用 CC0 或原創。**參考圖 `docs/reference/factory/*` 只當作風格與配置指引，沒有貼進任何貼圖**；沒有複製任何商業遊戲素材。下載與打包：`python3 tools/assets/fetch_cc0_factory.py`（原始 1K 檔放 `art/cc0_src/`，不打包進遊戲）。

### CC0 PBR 材質（4×4 圖集 `atlas_albedo/_normal/_orm.webp`，2048²，每格 512²；地板細節 `floor_*.webp` 1024²）
| 圖集格 | 用途 | 來源素材 | 來源網址 | 授權 | 修改 |
|---|---|---|---|---|---|
| 0 | 鋼柱、桁架、梁（藍灰漆鋼） | polyhaven：rusty_painted_metal | https://polyhaven.com/a/rusty_painted_metal | CC0 1.0 | 保留亮度細節，重新上色為鋼藍 |
| 1 | 深色舊鋼（橫檁、框、樓梯側板） | polyhaven：rusty_metal_sheet | https://polyhaven.com/a/rusty_metal_sheet | CC0 1.0 | 重新上色為深藍灰 |
| 2 | 鉚釘牆板 | polyhaven：blue_metal_plate | https://polyhaven.com/a/blue_metal_plate | CC0 1.0 | 重新上色（較暗） |
| 3 | 波浪屋頂板、上牆 | polyhaven：corrugated_iron_02 | https://polyhaven.com/a/corrugated_iron_02 | CC0 1.0 | 調色 |
| 4 | 安全黃漆（欄杆、天車、樓梯扶手、標誌） | polyhaven：painted_metal_shutter | https://polyhaven.com/a/painted_metal_shutter | CC0 1.0 | 重新上色為 #F2B705，保留剝落 |
| 5 | 捲門板條 | polyhaven：rusty_metal_shutter | https://polyhaven.com/a/rusty_metal_shutter | CC0 1.0 | 調色 |
| 6 | 橄欖綠機器 | polyhaven：green_metal_rust | https://polyhaven.com/a/green_metal_rust | CC0 1.0 | — |
| 7 | 灰色機器、電櫃 | polyhaven：metal_plate_02 | https://polyhaven.com/a/metal_plate_02 | CC0 1.0 | 調色 |
| 8 | 木箱、棧板 | polyhaven：brown_planks_03 | https://polyhaven.com/a/brown_planks_03 | CC0 1.0 | 調色 |
| 9 | 鏽蝕油桶、管線、鋼筋 | polyhaven：rusty_metal_02 | https://polyhaven.com/a/rusty_metal_02 | CC0 1.0 | 調暗 |
| 10 | 混凝土瓦礫 | polyhaven：concrete_floor_damaged_01 | https://polyhaven.com/a/concrete_floor_damaged_01 | CC0 1.0 | 調色 |
| 11 | 紫色油桶 | polyhaven：rusty_metal_03 | https://polyhaven.com/a/rusty_metal_03 | CC0 1.0 | 重新上色為紫 |
| 12 | 銅管、變壓器 | polyhaven：rusty_metal_04 | https://polyhaven.com/a/rusty_metal_04 | CC0 1.0 | 調色 |
| 13–15 | 黃黑斑馬紋、南瓜皮、黑橡膠／電纜 | 程序產生（numpy，同一支腳本） | — | 原創 | — |
| 地板 | 濕混凝土細節（3 m 平鋪） | polyhaven：hangar_concrete_floor | https://polyhaven.com/a/hangar_concrete_floor | CC0 1.0 | — |
| 旗子布料 | 紫／橘破布旗（`cutout.webp` 第 1、2 格） | polyhaven：fabric_pattern_07 | https://polyhaven.com/a/fabric_pattern_07 | CC0 1.0 | 灰階後上色＋程序撕裂邊、破洞 |
- 授權說明：Poly Haven https://polyhaven.com/license（CC0 1.0）。

### 原創（Blender 腳本程序建模、烘焙）
| 檔案 | 產生器 | 內容 | 授權 |
|---|---|---|---|
| `factory_v2.glb`（meshopt 壓縮，約 5.5 MB） | `tools/blender/build_factory_v2.py` → `bake_factory_v2.py`（gltfpack 壓縮） | 大廳＋30 種以上道具，約 12.8 萬三角形，所有可見邊倒角＋加權法線，頂點色（曲率磨損、髒汙、擺動權重、逐頂點烘焙光） | 原創 |
| `lightmap.webp`、`lightmap_half.webp`、`lightmap_floor.webp` | Cycles 烘焙（直射＋間接、柔和陰影）→ Open Image Denoise（Blender 合成器）→ RGBM HDR | 光照 | 原創 |
| `probe.webp` | Cycles 等距長方投影（大廳中央 1.2 m）→ RGBM | 濕地板盒投影反射 | 原創 |
| `floor_paint.webp` | `build_factory_v2.py` 的 numpy 繪製 | 3 m 板縫、裂縫、汙漬、黃色安全線、機器危險框、斑馬紋、水窪遮罩 | 原創 |
| `cutout.webp` | `bake_factory_v2.py`（numpy） | 格柵、紫／橘破布旗（布料細節來自上表 CC0）、蜘蛛網 | 原創＋CC0 |
| `factory_dress.json` | `build_factory_v2.py` | 走道上的南瓜、門燈、紫色壁燈、LED、斷線火花、蒸汽位置（執行時光暈／粒子用） | 原創 |
| 光錐、地面反光條、灰塵、火花、蒸汽、低霧 | `src/art/factoryV2.js`（執行時） | 氛圍 | 原創 |
- **KTX2／Basis 沒有使用**：同 v0.30，工具鏈沒有 basisu 編碼器，IWSDK 也沒設定轉碼器，改用 WebP；lightmap 用 RGBM（有損 RGB＋無損 alpha）。

## v0.40 世界追擊（八張地圖）
| 檔案／來源 | 用途 | 狀態 |
|---|---|---|
| `output/environments/*-concept-v1.png`、`moonlit-japanese-city-concept-v2.png`（使用者提供的概念圖） | 八張地圖的外觀參考 | 參考。依概念圖用程式重建成 3D 環境（`src/worlds/kits/`），概念圖本身不放進遊戲畫面 |
| `public/maps/<地圖>.jpg`（480×270） | 主選單／VR 地圖選單的預覽縮圖 | 由上面的概念圖縮小（PIL LANCZOS，JPEG q82），每張約 40–55 KB |
| `public/maps/classic.jpg` | 「達拉城——故事與街機」縮圖 | 由 `output/environments/dala-city-mobius-world-sketch-v1.png` 裁切縮小 |
| 建築、地形、天空、地面、粒子、錨點裝置 | 全部地圖 | **全部由程式即時產生**（`src/worlds/art/builder.js` 幾何建構器＋`shaders.js` 程序材質）：沒有外部模型、貼圖或付費資產，沒有授權問題 |
| 環境音（風、水、雨、鳥、鈴、冰晶、熔岩爆裂…） | 每張地圖 | WebAudio 程序合成（`src/worlds/ambience.js`），沒有音檔 |
| 綠狂魔／綠魔飛行器／南瓜彈／比特幣 | 追逐 | 沿用既有資產（同上表） |


### Foldscape City near-detail kit（v0.41）
| 檔案 | 來源 | 授權 |
|---|---|---|
| `public/models/foldscape/foldscape_kit.glb`＋`foldscape_kit.json`（`tools/blender/build_foldscape_kit.py`，Blender 5.2 bpy，程序建模） | 15 件 × LOD0/LOD1：磚窗開間（平拱／弧拱）、石灰岩開間、玻璃帷幕鰭片、店面、腰線、隅石、簷口、女兒牆、逃生梯（含斜梯／垂梯）、木水塔、空調箱、樓梯間、階梯式塔頂；298.8 KB | 原創 |
- 磚／石灰岩材質沿用上表的 CC0 陣列（`CITY_SHARED`，唯讀共用），沒有新增下載。紀錄：`docs/goals/foldscape-art-upgrade.md`。

### Foldscape daytime sky cities (2026-11-03)
- `public/textures/foldscape/daylight-skyline.png`: generated with the built-in imagegen tool for this project, transparent daylight New York city cutout. Prompt: `daylight-skyline-prompt.txt` in the same folder. No external stock source or purchased asset.
- `public/textures/foldscape/daylight-fold-district.png` (1536 × 1024 RGBA, concave folded city avenue) and `daylight-city-canopy.png` (1942 × 809 RGBA, upside-down curved city ribbon): transparent cutouts generated for this project and supplied by the project coordinator on 2026-11-03. Same origin as the skyline (no stock or purchased source). No prompt file was in the folder when v0.42 was written.
- v0.42 (`docs/goals/foldscape-surround-anchors.md`): `src/worlds/art/foldscapeSkyCards.js` now uses all three images. There are six cards in total. The skyline is split into four non-overlapping crops, and the district and canopy are each used once. The cards are merged into one mesh per image (3 draw calls, 12 triangles, 3 textures). They are alpha-tested, depth-writing and hazed, and they follow the far backdrop. Card sizes keep the crop's pixel aspect, and no part of a painting is repeated. The renderer owns them and disposes geometry, materials and textures with the backdrop. Near architecture remains 3D.

### Forest of Shadow Ruins art upgrade (v0.43, 2026-11-03)
| 檔案 | 來源 / 擁有權 | 處理 |
|---|---|---|
| `3D_Models/Forest_of_Shadow_Ruins/tree stump 3d model.glb`、`ancient ruin with roots 3d model.glb`、`stone knight 3d model.glb`、`ancient stone altar 3d model.glb` | **使用者以 Tripo 產生**（參考圖在同資料夾 `references/`） | 唯讀原檔，未修改（SHA-256 記錄在 `public/models/forest/forest_kit.json` 的 `heroes.*.sourceSha256`，`tests/forest-art.test.mjs` 每次驗證） |
| `public/models/forest/forest_heroes.glb` | 由上面四個原檔衍生 | `tools/blender/build_forest_kit.py`：合併 UV 接縫處重複頂點後 collapse 減面 — 樹根 8,017→6,000 / 1,499、纏根遺跡 10,130→7,000 / 1,799、守護者石像 22,851→8,000 / 8,000（LOD1＝LOD0）、祭壇 19,048→7,000 / 1,800；只保留 POSITION／NORMAL／TEXCOORD_0，無材質 |
| `public/models/forest/hero_roots.jpg`、`hero_ruin.jpg`、`hero_statue.jpg`、`hero_altar.jpg` | 由原檔底色貼圖縮小 | 8192²（祭壇 2048²）→ 1024² sRGB JPEG q88。祭壇的法線／粗糙金屬貼圖未使用；其他三個原檔本來就只有底色貼圖（含烘焙光影與苔蘚），沒有另外製作 PBR 貼圖 |
| `public/models/forest/forest_kit.glb`、`forest_kit.json` | **原創**，Blender 腳本程序建模（`tools/blender/build_forest_kit.py`） | 25 個零件 × 2 LOD：3 種樹幹、3 種樹冠、3 種樹冠葉團、板根、錨點樹瘤、垂藤、絞殺根、完整／斷拱、斷橋端、殘柱、斷牆頂、女兒牆、拱龕、碎石、2 種溪石、蕨類、灌木。頂點色＝烘焙 AO／材質 ID／變化遮罩；無貼圖 |
| 樹皮／石材／葉／溪流外觀 | **原創**，`src/worlds/art/shaders.js` 的 `FOREST` 分支（程序著色，無外部貼圖） | — |

沒有下載任何新的外部素材，也沒有使用影像生成服務。

### Forest foliage correction (v0.44, 2026-11-06)

| 檔案 | 來源 | 說明 |
|---|---|---|
| `public/models/forest/forest_leaf.png` | **原創**，`tools/blender/build_forest_kit.py` 內以 numpy 程序繪製（固定亂數種子，可重現；無外部圖片、無影像生成服務） | 1024² RGBA，4 格 512²：spray_a／spray_b（樹冠枝葉）、dense（遠景 LOD1 葉團）、hang（藤蔓／灌木大葉）。葉片有尖端、主脈、側脈、明暗兩半與接觸陰影，細枝在透明底上；透明像素以 pull-push 擴張葉色（避免過濾／mip 黑邊） |
| `public/models/forest/forest_kit.glb`、`forest_kit.json`（重建，`--no-heroes`） | **原創** | `cn_canopy_a/b/c`、`fx_bush`、`vn_hang` 的封閉圓球葉團改為枝幹支撐的葉片卡（材質 ID 8 → 圖集 UV，不隨實例縮放）；樹冠枝末端改為漸細。其他零件幾何不變；Tripo 英雄模型與貼圖未重建、未修改 |

## v0.43 背景音樂（BGM）
來源：使用者提供的 8 首 MP3（原檔在 `bgm/`，遊戲讀 `public/audio/bgm/` 的同名複本，未重新編碼；48 kHz、128 kbps）。對應與響度（ffmpeg ebur128 測得的整合響度，遊戲內統一調到 −20 LUFS 再經過「音樂音量」）：

| 場景 | 檔案 | 響度 | 增益 |
|---|---|---|---|
| 故事模式追擊綠狂魔（`chase`、`endless` 階段）＋世界追擊 折境都市（日光） | brand-new-universe-mobious-dala-city-bgm.mp3 | −14.6 LUFS | 0.537 |
| 幽影森林遺跡 | forest-shadow-ruins-bgm.mp3 | −15.1 | 0.569 |
| 赤岩峽谷 | redrock-canyon-bgm.mp3 | −16.0 | 0.631 |
| 霓虹科技城 | neon-tech-city-bgm.mp3 | −14.6 | 0.537 |
| 月夜和風城 | moonlit-japanese-city-bgm.mp3 | −13.7 | 0.484 |
| 雲上宮城 | cloud-palace-city-bgm.mp3 | −13.8 | 0.490 |
| 極光冰城 | aurora-ice-city-bgm.mp3 | −14.5 | 0.531 |
| 熔火要塞 | molten-fortress-bgm.mp3 | −15.2 | 0.575 |

