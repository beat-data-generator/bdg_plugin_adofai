# bdg_plugin_adofai — ADOFAI 导出插件

将 Beat Data Generator 的踩点工程导出为 **A Dance of Fire and Ice (.adofai)** 关卡文件。

---

## 一、使用

### 安装 / 开发

- 发布：把本文件夹放入宿主编辑器的 `<userData>/plugins`。
- 开发：插件宿主在开发模式下会扫描项目根目录的 `plugins/`，把本目录作为扫描根即可。
- 改代码后跑类型检查：`npm run typecheck`。

### 使用流程

1. 在工程里新建插件轨道：**多押轨道**、**BPM 轨道**（旋转轨道已从 UI 移除，旧数据仍生效）。
2. 在这些轨道上踩点，并按需填写踩点属性（多押类型 / 角度、BPM 类型 / 数值等）。
3. 打开「**ADOFAI 导出设置**」面板，按需调整偏移等选项。
4. 用「导出」菜单或「插件」菜单的导出按钮生成 `.adofai`；若命中导出检查会弹窗提醒（不阻拦）。

> 多押参数由多押轨道的踩点属性驱动；`songFilename / bpm / offset` 仍由工程快照提供。

### 轨道一览

**多押轨道** `dev.bdg.adofai-export:multi`（「多押轨道」/「多押点」），踩点表单三个字段：

- **多押类型**：`单轨`（single）/ `中旋`（midspin）/ `多押`（multi）
- **最大押数**：默认 `3`（范围 2–8）
- **多押角度**：`1° / 5° / 15° / 22.5° / 30°`（默认 `15°`）

**BPM 轨道** `dev.bdg.adofai-export:bpm`（「ADOFAI BPM 轨道」），字段：

- `speedType`：`multiplier`（倍频）/ `bpm`（BPM 值）
- `value`：数值

**旋转轨道** `dev.bdg.adofai-export:twirl`（「ADOFAI 旋转轨道」/「旋转点」），无字段。

### 导出设置面板（「ADOFAI 导出设置」）

浮动面板，设置以 `localStorage`（键 = `<pluginId>:config`）持久化：

- **变速放置位置偏移**（默认 `1`）：生成的 `SetSpeed` 事件 `floor += 偏移`（正数往后挪格）；`floor ≤ 0` 仍按 floor 0 规则写进 `settings.bpm`。
- **暂停数值修复#1**（默认开）：对 `Pause` 的 `duration` 做修正 —— `(1,2)` 向上取整为 `2`，`(2,3)` 向下取整为 `2`；关闭则保持 `diffEff − 1`。
- **双押旋转（测试）**（默认关）：多押轨道 `multiType = multi` 且该 beat 押数 `= 2` 时，在插入块所在格（原格 `+ 1`）生成一个 `Twirl`，并从该格起翻转 `angleData` 的角度符号（`dir` 镜像）。口径由代码常量 `DOUBLE_PRESS_TWIRL = { floorOffset, flipDir }` 定义。

### 导出检查（仅提醒，不阻拦导出）

导出前扫描，命中则弹窗列出位置（同时写入日志），确认后照常导出：

- **变速区间**：某段累积 BPM 落在 `(8×baseBpm, 16×baseBpm)` 之间时，逐点列出 `beat / floor / 实际 BPM / 倍率`。
- **多押夹角**：多押（含中旋）模式下，某个**真·多押 beat**（同 beat ≥2 音砖）的有效 `travel = 有效拍数 × 180°` 小于该点多押角度时，逐点列出 `beat / floor / travel / 多押角度`。普通单押 beat 不检查。（`travel` 用有效拍数直算，避免 `|180 − step|` 在整拍间隔下因 `step` 取模得出假的 `travel=0`。）

### 导出关卡（「导出」菜单 + 「插件」菜单按钮）

生成 `.adofai` 文件；无音砖时 `angleData` 为空数组。导出内容的字段含义见「三、技术细节」。各轨道的约束（踩点必须落在音砖 beat 上，否则拒绝导出）见「二、说明」。

---

## 二、说明

### 多押轨道

**状态机语义**：多押点是「模式」标记——从该点起改写当前处理状态，并持续作用到后面，直到遇到下一个多押点再切换；初始状态为单轨。处理规则统一：每个 beat 都按当前状态生成。

**只处理真·多押音砖**：只有同一 beat 上有 **≥2 个音砖** 时才按状态处理；普通单押 beat 一律不处理（即使当前状态是多押）。各状态的处理结果：

- `单轨`：合并成单块（不插入）。
- `中旋`：在**原格之前**插 `[X₁, 999, X₂, 999, …]`，即 `[X₁, 999, …, 原格]` 写法（真·中旋，N 押 N 键）。押数 = `min(押数, 最大押数)`，插 `押数 − 1` 对 `[Xᵢ, 999]`；第 i 个折返角 `sᵢ = i × 多押角度`。原格角度不变，travel 由 `T` 变 `T − Σsᵢ`；`Xᵢ` 折返格 travel = `sᵢ`、`999` 格 travel = 0 ⇒ `Σsᵢ + 0 + (T − Σsᵢ) ≡ T`，前后时序与下游角度**零净偏移**。`X₁` 是准时按下。`T − Σsᵢ < 15°`（装不下）则该点多押**跳过**并记日志。
- `多押`：在**原格之后**插 `min(押数, 最大押数) − 1` 块，每块 travel 均为多押角度（`180 − 多押角度` 的折返）；`carry` 累加为 `插入块数 × 多押角度`（双押 15 / 三押 30 / 四押 45…）。

**生成模型**：`中旋` 走 `[X₁, 999, X₂, 999, …, 原格]` 三格家族（见 `core/dp_midspin.py`）；`多押` 为当前块角度不变、插入块加 `180 − 多押角度`，下一块用 `carry` 补 `插入块数 × 多押角度` 回正（叠加在正常角度之上）。

**约束**：多押点必须落在某个音砖的 beat 上，否则导出会被拒绝并弹窗提示。

### BPM 轨道

**BPM 累积**：从 `baseBpm` 起按顺序套用每个点——

- **BPM 值**：绝对重置当前 BPM；
- **倍频**：乘在**当前 BPM**上（连续两个 `2` 倍频 ⇒ ×4；若前一个是 `120`，其后倍频以 `120` 为基数相乘）。

角度换算用累积后的倍率：`diffEff = 拍差 × (累积BPM / baseBpm)`。
事件字段：倍频 → `bpmMultiplier = value`（游戏按当前 BPM 累积），`beatsPerMinute` 写累积后的绝对值；BPM 值 → `beatsPerMinute = value`、`bpmMultiplier = 1`。

**约束**：BPM 点必须恰好落在某个音砖的 beat 上，否则导出会被拒绝并弹窗提示。

### 旋转轨道（Twirl）

> 已从 UI 移除（不再可创建），但内部生成逻辑（`readTwirlSet` / `buildTwirl` / `dir` 镜像）保留。若工程里仍留有旧旋转点，导出仍会生效。

其点生成：

```json
{"floor": 76, "eventType": "Twirl"}
```

**角度镜像**：每遇一个旋转点，角度方向的符号 `dir` 翻转一次（+1 → -1 → +1…），导出的 `angleData` 值为 `dir × current`，即旋转后角度取负（镜像）、再旋转回正。内部 `step`/carry 逻辑不因旋转改变。

**约束**：旋转点也必须落在某个音砖的 beat 上，否则拒绝导出。

---

## 三、技术细节

### 文件结构

```
bdg_plugin_adofai/
├─ manifest.json   # 插件元信息（id=dev.bdg.adofai-export）
├─ renderer.js     # 渲染进程入口：导出逻辑 + BPM / 多押 类型化轨道
├─ main.js         # 主进程入口（预留，目前仅一个 ping 处理器）
└─ README.md
```

### 导出的 .adofai 结构

```json
{
  "angleData": [...],
  "settings": {...},
  "actions": [...],
  "decorations": []
}
```

### angleData

每块按 `step = (1 − diffEff) × 180`（mod 360）累计，`diffEff = 拍差 × 局部BPM倍率`。

### settings

默认值取自样例 `level.adofai`，仅 3 项由工程快照覆盖：

- `songFilename` ← `audioName`
- `bpm` ← `baseBpm`（若 BPM 轨道点在 floor ≤ 0，则改为该点累积后的 BPM，因为 floor 0 的 `SetSpeed` 会被引擎忽略）
- `offset` ← `offsetMs`

### actions

- `Pause`：当相邻音砖有效拍差 `diffEff > 2` 时插入（放在间隙末块，floor=`beatFloor[j+1]`），时长 `duration = diffEff − 1`（开启「暂停数值修复#1」时再对 `(1,2)/(2,3)` 取整为 2）。
- `SetSpeed`：来自 BPM 轨道，`{"floor","eventType":"SetSpeed","speedType","beatsPerMinute","bpmMultiplier","angleOffset":0}`；`floor` 会加上「变速放置位置偏移」。同 floor 时 SetSpeed 排在 Pause 之前。落在 `floor ≤ 0` 的点不生成事件，改为写入 `settings.bpm`（初始 BPM）。

---

## 已知问题（未解决）

1. **Pause 时长规则不统一**：`duration = diffEff − 1` 在多数点位实测正确（如 floor2、floor4），但个别点位（如 floor64，`diffEff = 6`）用户反馈应为 `diffEff − 2`；两者无法用单一规律同时满足，待厘清。
