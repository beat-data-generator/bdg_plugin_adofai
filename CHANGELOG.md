# Changelog

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
