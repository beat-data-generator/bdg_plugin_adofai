# Changelog

## 未发布

### 新版（modern）
- **变速对齐**：逐拍差改走工程 tempo map（`api.project.timeOfBeat`），角度 / Pause / 夹角检查都用真实时间差换算的「基础拍」；复杂变速段落不再按等拍网格累积漂移。onset 检测确认音频严格跟随该 tempo map。
- **Pause 修正**：`diffEff == 2` 时该格本身就是 2 拍（`[0,180]` 实测，Twirl 与否均为 2.0），不再额外补 `Pause 1`；修复 floor 675–692 等处每格多出一拍暂停。Pause 只用于 `diffEff > 2` 的长间隔。
- **BPM 轨道**：倍频改为相对**上一个 BPM 点**累积（游戏编辑器口径）：`target = 当前 BPM × value`，无前置点则基于 `baseBpm`；`bpmMultiplier` 写 `target / 上一事件后的 BPM`。与 legacy 的累积语义统一，两模型差别仅在 `settings.bpm` / 事件写法。

## 0.4.1

将 0.3.1–0.3.5 的修复与功能同步进本项目。**全部只在新版（modern）生效，legacy 导出仍与 0.2 逐字节一致。**

### 新版（modern）
- 倍频改为相对**基础 BPM**（`baseBpm × value`），`bpmMultiplier` 写相邻目标比值，`settings.bpm` 取首拍 BPM；不再累积衰减（0.3.1）。
- 新增**绝对拍位吸附** `snapBeatPos`：`snapNearInt` 开启时，踩点/多押/BPM/旋转/装饰都把近整数拍位置吸到整数，治 `640.9668` 这类杂点产生的 174° 假回头（0.3.2）。
- **Pause** 改用起点 beat 的 BPM，并按最终 `angleData` 判断发卡格：发卡占 2 拍、`diffEff=2` 被 carry 拉直时补 `Pause 1`、长发卡再减 1（0.3.3）。
- 自动 Twirl 改为**弧长模型**：按每格 `floorDiffEff` 目标行进区分短弧/长弧（8 分短弧、附点四分 270° 长弧）（0.3.4/0.3.5）。
- 新增 **`2.5°`** 多押角度选项；当前拍 BPM 严格小于基础 BPM 的 1/2 时，有效角度自动封顶 `min(设定角度, 2.5°)`，离开低速段恢复（0.3.5）。
- 关卡音乐：`songFilename` 取音频文件名；导出时把音频复制到关卡同目录（已存在则跳过）（0.3.4）。
- 默认 settings 对齐 v19 示例：`version 19` / `zoom 200` / 默认背景关（0.3.4）。

### 兼容
- `legacy` 分支行为不变：累积倍频、终点 BPM Pause、旧自动 Twirl、`audioName` 直接写入、0.2 默认 settings、不复制音频。
- 逐拍差仍统一走 `buildDiffTable`；`floorDiffEff` 只服务新版自动 Twirl。

## 0.4.0

双核心模型：保留旧版行为，同时补齐新版（0.3.0）全部功能。

### 兼容
- 新增 `coreModel`：`legacy`（0.2 行为）/ `modern`（0.3 行为），只切换 3 处分歧：
  多押折返方向、正常步进符号、Twirl 来源。
- 旧版模型 = 0.2 导出结果：轨道启发式（吸附 / 快速跑动 / 发卡后处理）强制忽略，
  即使配置里残留开启；保留 0.2 的同 floor 事件排序（`Twirl → Pause → SetSpeed`）。
- 新版模型 = 0.3 轨道生成；新版预设默认 `twirlMode="auto"`（新版轨道需要自动 Twirl 才正常）。
- `modern + 手动 Twirl` 仍与 0.3 默认一致。
- 配置加入 `configVersion` 与迁移：旧配置默认迁移为 `legacy`，
  旧 `doublePressTwirl` 保留为 `legacyDoubleTwirl`，不静默改谱。
- `doublePressTwirl` 语义不再复用：旧行为改名 `legacyDoubleTwirl`，
  新版自动 Twirl 改为 `twirlMode = "auto"`。

### 新增选项
- `pauseFix2` 暂停数值修复#2。
- `snapNearInt` + `snapTolerance` 近整拍吸附。
- `rapidRuns` 快速跑动形态。
- `normalizeAngles` 发卡弯同号 / 闭环朝上。
- `twirlMode`：`manual` / `auto` / `off`。
- `multiTurn`：`auto` / `inner` / `outer`（modern）。
- `fakeLanes` + `laneGap` + `spacingX` + `barBeats` 装饰泳道。
- `showChecks` 导出前检查开关。
- `autoTwirlThreshold` / `hairpinExclude` 自动 Twirl 阈值。

### 新增功能
- 装饰泳道：菱形/行星、小节线、播放头，导出 `bdg_lane_*.png`。
- 多轨预览面板 + 项目栏快捷按钮。
- 逐拍差统一为 `buildDiffTable`，角度/Pause/检查共用。
- 导出健壮性：取消保存、写入失败、素材写入失败均有提示与 `catch`。

### 修复
- 装饰物补齐 v19 字段，`relativeTo` 使用 `"Tile"`。
- 事件排序加入 `MoveDecorations`。

## 0.3.0
- 多押改为内圈折返，`carry` 按折返方向回落，后续走向跟随。
- 自动 Twirl 按最终 `angleData` 生成（默认关）。
- 快速跑动形态、近整拍吸附、发卡后处理（默认关）。
- 装饰泳道、多轨预览。

## 0.2.0
- 多押轨道（单轨 / 中旋 / 多押）、BPM 轨道（BPM 值 / 倍频累积）、暂停与变速补偿。
- 中旋 `[X₁, 999, X₂, 999, …, 原格]` 写法，零净偏移。
