# bdg_plugin_adofai — ADOFAI 导出插件

将 Beat Data Generator 的踩点工程导出为 **A Dance of Fire and Ice (.adofai)** 关卡文件。

## 文件结构

```
bdg_plugin_adofai/
├─ manifest.json   # 插件元信息（id=dev.bdg.adofai-export）
├─ renderer.js     # 渲染进程入口：导出逻辑 + 设置面板 + BPM 类型化轨道
├─ main.js         # 主进程入口（预留，目前仅一个 ping 处理器）
└─ README.md
```

## 安装 / 开发

- 发布：把本文件夹放入宿主编辑器的 `<userData>/plugins`。
- 开发：插件宿主在开发模式下会扫描项目根目录的 `plugins/`，把本目录作为扫描根即可。
- 改代码后跑类型检查：`npm run typecheck`。

## 功能

### 设置面板（「插件」菜单）

浮动静默面板，含两个下拉框：

- **多押处理**：`单轨` / `多押` / `中旋`
  - `单轨`：同一 beat 只保留一个音砖（去重）。
  - `多押`：同一 beat 有多个 marker 时，在其后插一块表示双押：当前块角度不变，插入块加 `180−双押角度`，下一块用 `carry` 补 `+双押角度`（叠加在正常角度之上）。中旋目前复用同一逻辑。
  - `中旋`：暂与 `多押` 相同，待拆分独立行为。
- **双押角度**：`15° / 22.5° / 30°`，用于双押插入的补偿角。

### 导出（「导出」菜单 + 「插件」菜单按钮）

生成 `.adofai`，结构为：

```json
{
  "angleData": [...],
  "settings": {...},
  "actions": [...],
  "decorations": []
}
```

- **angleData**：每块按 `step = (1 − diffEff) × 180`（mod 360）累计，`diffEff = 拍差 × 局部BPM倍率`。
- **settings**：默认值取自样例 `level.adofai`，仅 3 项由工程快照覆盖：
  - `songFilename` ← `audioName`
  - `bpm` ← `baseBpm`
  - `offset` ← `offsetMs`
- **actions**：
  - `Pause`：当相邻音砖有效拍差 `diffEff > 2` 时插入（放在间隙末块，floor=`beatFloor[j+1]`），时长 `duration = diffEff − 1`。
  - `SetSpeed`：来自 BPM 轨道，`{"floor","eventType":"SetSpeed","speedType","beatsPerMinute","bpmMultiplier","angleOffset":0}`；同 floor 时 SetSpeed 排在 Pause 之前。
- 无音砖时 `angleData` 为空数组。

### BPM 轨道

`dev.bdg.adofai-export:bpm`（「ADOFAI BPM 轨道」），字段：

- `speedType`：`multiplier`（倍频）/ `bpm`（BPM 值）
- `value`：数值

其点生成 `SetSpeed` 事件；倍率用于 `angleData` 与 `Pause` 的换算：
- 角度：`diffEff = 拍差 × 倍率`
- 倍频 → `bpmMultiplier = value`；BPM 值 → `beatsPerMinute = value`，换算倍率 `value / baseBpm`

**约束**：BPM 点必须恰好落在某个音砖的 beat 上，否则导出会被拒绝并弹窗提示。

### 旋转轨道（Twirl）

`dev.bdg.adofai-export:twirl`（「ADOFAI 旋转轨道」/「旋转点」），无字段。其点生成：

```json
{"floor": 76, "eventType": "Twirl"}
```

**角度镜像**：每遇一个旋转点，角度方向的符号 `dir` 翻转一次（+1 → -1 → +1…），导出的 `angleData` 值为 `dir × current`，即旋转后角度取负（镜像）、再旋转回正。内部 `step`/carry 逻辑不因旋转改变。

**约束**：旋转点也必须落在某个音砖的 beat 上，否则拒绝导出。

## 已知问题（未解决）

1. **Pause 时长规则不统一**：按 `duration = diffEff − 1` 生成，floor2（eff3→2）、floor4（eff12→11）实测正确；但 floor64（eff6→自动 5）用户反馈应为 4（=`diffEff − 2`）。`diffEff−1` 与 `diffEff−2` 无法同时满足 floor2/floor4 与 floor64，无统一规律，待厘清。

2. **慢速区（mult<1，如 0.5）角度不规整**：该区音符较密（0.25/0.5 间隔），`diffEff = 原始×倍率` 偏小（≈0.125~0.375），套公式 step ≈ 112~157°，几乎逐块折返成锯齿而非直线。用户期望「每块 0° 直行 + 仅大间隔暂停」；曾试验强制 0° 直行，副作用更多，已回退。

3. **慢速区大间隔缺暂停**：如 72→76 拍，原始拍差 4，但 `×0.5` 后 `diffEff=2`，当前 `diffEff>2` 条件不触发 → 无暂停。快区需要 `diffEff>2`、慢区需要原始拍差判断，单一条件无法兼顾。

4. **快区 `diffEff=2` 的偶数拍差也漏暂停**（如 mult=2 区 `diffEff=2` 点位）——`diffEff>2` 阈值使其不被捕获。

5. **「360° 夹角 / 2拍」问题**：当步进 wrap 成 0 但实际代表 >1 拍（`diffEff` 为奇数，如 3、5）时，一个角度块会「看」成 1 拍，需用暂停补差值。试验 360°→180° 修正后副作用增多（360° 角反而变多），已回退，未定论。

6. **floor64 时长差 1**（=问题1 的具体案例）：位于 ×4 快区，其步进本就是 180°（`diffEff=6` 偶数），上述角度修正均不命中它，需单独规则。

7. **慢速区直线方案**：曾尝试 `mult<1` 强制 step=0（直行）+ `slowBigGap` 补充大间隔暂停，副作用更多，已回退。

8. **双押模式生成其他角度仍存在问题**：`多押`/`中旋` 模式中，同一 beat 多插一块并用 `180 − 双押角度` / `+双押角度`（carry）补差的方式生成的额外角度，在实际产物中仍不够理想（与普通步进累加的结果有偏差），暂未达到预期。

9. **多押模式存在部分延迟问题**：`多押`（multi，目前中旋复用同一逻辑）在双押插入处通过 `carry` 给下一块补 `+夹角`，但该补偿只作用在紧邻的下一块角度上，并不完全等价于「同一瞬间按下」，导致个别拍的实际触发时点相对乐谱有延迟偏差；短谱累计不足一格不显耳，长谱上更明显。待以参考的 `angleOffset` 对准方案或精确时值补偿解决。

## 已修复问题

- **BPM 轨道被计入音轨时间轴**：`scanBeats` 原先把 BPM 轨道点也合并进音砖序列和双押判定，导致 BPM 点处产生多余 floor / 假双押。现已排除 BPM 轨道（仅统计音砖轨道），BPM 点只用于发 `SetSpeed`。
- **Pause 时长未乘倍率**：初版用 `(diff−1)`；依据引擎（Re_ADOJAS `levelLoaderWorker.ts`）确认 Pause 时长为拍数，修正为 `diffEff − 1`。
- **暂停触发改用有效拍差**：由原始拍差 `diff>2` 改为 `diffEff>2`，覆盖变速区。
- **旋转（Twirl）角度镜像**：旋转后角度原被 `wrap360` 成 0–360 正数，丢失镜像；现导出值改为 `dir × current`，旋转区段自动取负、回正，与手改产物一致。
