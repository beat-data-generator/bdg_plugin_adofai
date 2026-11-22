window.__bdgPluginRegister(function activate(api) {
  api.log("renderer entry activated (id=" + api.id + ")");

  var DEFAULT_SETTINGS = {
    version: 15,
    artist: "",
    specialArtistType: "None",
    artistPermission: "",
    song: "",
    author: "",
    separateCountdownTime: true,
    previewImage: "",
    previewIcon: "",
    previewIconColor: "003f52",
    previewSongStart: 0,
    previewSongDuration: 10,
    seizureWarning: false,
    levelDesc: "",
    levelTags: "",
    artistLinks: "",
    speedTrialAim: 0,
    difficulty: 1,
    requiredMods: [],
    volume: 100,
    pitch: 100,
    hitsound: "Kick",
    hitsoundVolume: 100,
    countdownTicks: 4,
    songURL: "",
    tileShape: "Long",
    trackColorType: "Single",
    trackColor: "debb7b",
    secondaryTrackColor: "ffffff",
    trackColorAnimDuration: 2,
    trackColorPulse: "None",
    trackPulseLength: 10,
    trackStyle: "Standard",
    trackTexture: "",
    trackTextureScale: 1,
    trackGlowIntensity: 100,
    trackAnimation: "Fade",
    beatsAhead: 8,
    trackDisappearAnimation: "Fade",
    beatsBehind: 0,
    backgroundColor: "000000",
    showDefaultBGIfNoImage: true,
    showDefaultBGTile: true,
    defaultBGTileColor: "101121",
    defaultBGShapeType: "Default",
    defaultBGShapeColor: "ffffff",
    bgImage: "",
    bgImageColor: "ffffff",
    parallax: [100, 100],
    bgDisplayMode: "FitToScreen",
    imageSmoothing: true,
    lockRot: false,
    loopBG: false,
    scalingRatio: 100,
    relativeTo: "Player",
    position: [0, 0],
    rotation: 0,
    zoom: 100,
    pulseOnFloor: true,
    bgVideo: "",
    loopVideo: false,
    vidOffset: 0,
    floorIconOutlines: false,
    stickToFloors: true,
    planetEase: "Linear",
    planetEaseParts: 1,
    planetEasePartBehavior: "Mirror",
    defaultTextColor: "ffffff",
    defaultTextShadowColor: "00000050",
    congratsText: "",
    perfectText: "",
    legacyFlash: false,
    legacyCamRelativeTo: false,
    legacySpriteTiles: false,
    legacyTween: false,
    disableV15Features: false,
  };

  function wrap360(v) {
    v %= 360;
    if (v < 0) v += 360;
    return v;
  }

  // 工程里的 beat 是浮点数，同一位置常出现 25 与 25.000000000000004 这种重复值。
  // 统一吸附到 1e-6 精度，避免被当成两个 beat：否则第二个 beat 的差值 ≈0，
  // 生成 step=180° 的“回头/整圈”块，游戏按 360°（2 拍）播放，导致后续整体后移。
  function snapBeat(v) {
    return Math.round(v * 1e6) / 1e6;
  }

  // 近整拍吸附：踩点若因毫秒取整等原因落在整拍附近（如 0.9668、1.0063 拍），
  // 直接按原始拍差计算会生成几度的“意义不明的弯曲”。这里只吸附距离整数
  // ≤ 0.05 拍的拍差；1/2、1/3、1/4 等正常细分距整数远，不受影响。
  var NEAR_INT_TOL = 0.05;

  function snapDiff(diff) {
    var r = Math.round(diff);
    if (r < 1) return diff; // 不把 <0.5 的拍差吸成 0
    var delta = Math.abs(diff - r);
    if (delta > NEAR_INT_TOL || delta < 1e-9) return diff;
    return r;
  }

  // 逐拍差只算一次：角度、Pause、夹角检查共用同一份吸附结果，日志也只记一次。
  function buildDiffTable(beats) {
    var out = new Array(beats.length);
    out[0] = 0;
    for (var j = 1; j < beats.length; j++) {
      var raw = beats[j] - beats[j - 1];
      var snapped = config.snapNearInt ? snapDiff(raw) : raw;
      out[j] = snapped;
      if (snapped !== raw) {
        panelLog(
          "  (近整拍吸附) beat " + beats[j - 1] + "→" + beats[j] +
            " diff " + raw + " -> " + snapped,
        );
      }
    }
    return out;
  }

  // 中旋写法 [X₁,999,X₂,999,…,原格] 的参数（见 core/dp_midspin.py）：
  //   MIDSPIN    999 → 0 拍、出角=入角，与下一格同一瞬间按下
  //   DP_MIN_TRAVEL 原格 travel 被吃掉 Σsᵢ 后不能低于此值，否则成回头方块
  var MIDSPIN = 999;
  var DP_MIN_TRAVEL = 15;

  // 伪双押（multi + 押数=2）：折返方向按当前走向统一朝向。
  // 是否需要 Twirl 由收尾的自动 Twirl 规则按最终 angleData 统一决定（默认关）。

  var bpmKey = api.id + ":bpm";
  var multiKey = api.id + ":multi";
  var twirlKey = api.id + ":twirl";

  // 面板设置：变速放置位置偏移（floor 相加，正数往后挪格）、暂停数值修复#1。
  // v2: 用 api.storage（按插件隔离、主进程落盘）替代 localStorage。
  var CONFIG_KEY = "config";
  var config = api.storage.get(CONFIG_KEY, null);
  // 新增的启发式默认全关，避免升级后静默改变既有工程的导出结果。
  if (!config || typeof config !== "object") {
    config = {
      speedPlaceOffset: 1,
      pauseFix1: true,
      pauseFix2: false,
      doublePressTwirl: false,
      snapNearInt: false,
      normalizeAngles: false,
      rapidRuns: false,
      fakeLanes: false,
      laneGap: 0.5,
      spacingX: 0,
    };
  } else {
    if (typeof config.speedPlaceOffset !== "number") config.speedPlaceOffset = 1;
    if (typeof config.pauseFix1 !== "boolean") config.pauseFix1 = true;
    if (typeof config.pauseFix2 !== "boolean") config.pauseFix2 = false;
    if (typeof config.doublePressTwirl !== "boolean")
      config.doublePressTwirl = false;
    if (typeof config.snapNearInt !== "boolean") config.snapNearInt = false;
    if (typeof config.normalizeAngles !== "boolean")
      config.normalizeAngles = false;
    if (typeof config.rapidRuns !== "boolean") config.rapidRuns = false;
    if (typeof config.fakeLanes !== "boolean") config.fakeLanes = false;
    if (typeof config.laneGap !== "number") config.laneGap = 0.5;
    if (typeof config.spacingX !== "number") config.spacingX = 0;
  }
  function saveConfig() {
    api.storage.set(CONFIG_KEY, config);
  }

  function findTrack(s, tid) {
    for (var i = 0; i < s.tracks.length; i++) {
      if (s.tracks[i].id === tid) return s.tracks[i];
    }
    return null;
  }
  function isBpmTrack(t) {
    return t && (t.type === bpmKey || t.type === "bpm");
  }
  function isMultiTrack(t) {
    return t && (t.type === multiKey || t.type === "multi");
  }
  function isTwirlTrack(t) {
    return t && (t.type === twirlKey || t.type === "twirl");
  }

  // 只统计音砖轨道（排除 BPM 与多押事件轨道）：多押点只声明该位置怎么多押，不产生音砖。
  function scanBeats(s) {
    var counts = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isBpmTrack(track) || isMultiTrack(track)) continue;
      var beat = snapBeat(m.beat);
      if (beat in counts) counts[beat]++;
      else counts[beat] = 1;
    }
    var beats = [];
    for (var b in counts) beats.push(parseFloat(b));
    beats.sort(function (a, b) {
      return a - b;
    });
    return { beats: beats, counts: counts };
  }

  // 多押轨道点 → { beat: { multiType, maxKeys, angle } }
  function readMultiPress(s) {
    var plan = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (!isMultiTrack(track)) continue;
      var attrs = m.attrs || {};
      var multiType = attrs.multiType || "single";
      var maxKeys = Number(attrs.maxKeys != null ? attrs.maxKeys : 3);
      var angle = Number(attrs.angle != null ? attrs.angle : 15);
      if (!(maxKeys >= 2)) maxKeys = 2;
      plan[snapBeat(m.beat)] = { multiType: multiType, maxKeys: maxKeys, angle: angle };
    }
    return plan;
  }

  function readBpmPoints(s) {
    var out = [];
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isBpmTrack(track) && m.attrs) {
        out.push({
          beat: snapBeat(m.beat),
          type: m.attrs.speedType,
          value: Number(m.attrs.value),
        });
      }
    }
    out.sort(function (a, b) {
      return a.beat - b.beat;
    });
    return out;
  }

  function readTwirlSet(s) {
    var set = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isTwirlTrack(track)) set[snapBeat(m.beat)] = true;
    }
    return set;
  }

  // 展开 floor：普通一个 beat 一块；多押点在该 beat 之前/之后再插块…
  //   multiType = single  → 不插（单轨）
  //   midspin → 在「原格」之前插 [X₁,999,X₂,999,…]（真·中旋，N 押 N 键，零净偏移）
  //   multi   → 在原格之后插 min(押数, 最大押数)−1 块（最多 maxKeys 键）
  // 状态机模型：处理规则统一——每个 beat 都按「当前多押状态」生成块。
  //   - 多押点会改写当前状态，并从该点起作用于它自己和它后面的所有 beat；
  //   - 后面若再遇到新多押点，则从新点起切换到新状态。
  //   - 初始状态 = 单轨。
  // 中旋写法（对齐 core/dp_midspin.py 的三格 [X, 999, 原格]，>2 押叠加）：
  //   押数 = min(押数, 最大押数)，插 presses−1 对 [Xᵢ, 999]；
  //   第 i 个折返角 sᵢ = i × 多押角度；原格角度不变，travel 从 T 变 T−Σsᵢ；
  //   ⇒ Σsᵢ + 0 + (T−Σsᵢ) ≡ T，前后时序与下游角度都零净偏移。
  //   X₁ 是准时的那次按下（主音压 X₁）。放不下 Σsᵢ 则跳过该点多押（记日志）。
  // 多押写法：插入块角度 = 当前 + (180 − angle)（各块 travel = angle）；
  //   下一块用 carry 补回「插入块数 × angle」（累加修正）。
  function buildAngleData(beats, counts, multiPlan, multAt, twirlSet, diffTable) {
    var angleData = [];
    var beatFloor = [];
    var dpTwirlFloors = []; // 自动 Twirl（测试）：额外生成的 Twirl 事件 floor
    var current = 0;
    var carry = 0;
    var dir = 1;
    // 走向符号：双押折返后，后续轨道（尤其 24 分快速跑动形成的“多边形”）
    // 的走向要跟随折返方向，而不是永远同向，否则多边形会朝错的一侧展开。
    var stepSign = 1;
    // 快速跑动形态（以范例为准）：
    //   8 分(1/2 拍)→三角 N=2；6 分(2/3 拍)→三角 N=3；
    //   16/32 分(1/4、1/8…，2 的幂倒数)→之字 N=1；
    //   12/24 分(1/3、1/6…)→同号（螺旋，不逐组换向）。
    var rapidCount = 0;
    var rapidBase = stepSign;
    var prevRapid = false;
    var prevN = 0;
    var rapidMode = 0; // 1=三角/之字（参与换向），0=同号
    var rapidModePrev = 0;
    var state = { multiType: "single", maxKeys: 3, angle: 15 }; // 初始：单轨
    for (var j = 0; j < beats.length; j++) {
      var diff = j === 0 ? 0 : diffTable[j];
      var mult = j === 0 ? 1 : multAt(beats[j - 1]);
      var diffEff = diff * mult;
      var step = j === 0 ? 0 : wrap360((1 - diffEff) * 180);
      if (twirlSet && twirlSet[beats[j]]) dir = -dir;

      // 状态切换：该 beat 有多押点 → 从当前点起改用新状态（含单轨=关闭多押）
      var mp = multiPlan[beats[j]];
      if (mp) {
        state = { multiType: mp.multiType, maxKeys: mp.maxKeys, angle: mp.angle };
        panelLog(
          "  (状态切换) beat=" + beats[j] +
            " -> type=" + state.multiType +
            " maxKeys=" + state.maxKeys +
            " angle=" + state.angle,
        );
      }

      // 仅当该 beat 本身是「多押」（同 beat ≥2 个音砖）时才处理；
      // 普通单押 beat 一律不处理（即使当前状态是多押）。
      var pressCount = counts[beats[j]] || 1;
      var isMultiBeat = pressCount >= 2;

      // 快速跑动：按细分形态决定是否换向（三角/之字），12/24 分同号。
      var isRapid =
        config.rapidRuns &&
        j > 0 &&
        diffEff > 1e-9 &&
        diffEff < 1 - 1e-9 &&
        !(isMultiBeat && state.multiType === "multi");
      var effSign = stepSign;
      if (isRapid) {
        var q = 1 / diffEff;
        var qr = Math.round(q);
        var isPow2Fine = Math.abs(q - qr) < 0.03 && qr >= 4 && (qr & (qr - 1)) === 0;
        var is8 = Math.abs(diffEff - 0.5) < 0.02;
        var is6 = Math.abs(diffEff - 2 / 3) < 0.02;
        if (is8 || is6) {
          var groupN = is8 ? 2 : 3;
          if (!prevRapid || rapidModePrev !== 1 || groupN !== prevN) {
            rapidCount = 0;
            rapidBase = stepSign;
          }
          var blk = Math.floor(rapidCount / groupN);
          effSign = blk % 2 === 0 ? rapidBase : -rapidBase;
          rapidCount++;
          prevN = groupN;
          rapidMode = 1;
        } else if (isPow2Fine) {
          if (!prevRapid || rapidModePrev !== 2) {
            rapidCount = 0;
            rapidBase = stepSign;
          }
          effSign = rapidCount % 2 === 0 ? rapidBase : -rapidBase;
          rapidCount++;
          rapidMode = 2;
        } else {
          // 12/24 分等：同号（保持 stepSign），不参与快速跑动换向。
          rapidCount = 0;
          rapidMode = 0;
        }
      } else {
        rapidCount = 0;
        rapidMode = 0;
      }
      rapidModePrev = rapidMode;
      prevRapid = isRapid;

      current = wrap360(current + effSign * step + carry);
      panelLog(
        "tile#" + j +
          " beat=" + beats[j] +
          (j === 0 ? "" : " diff=" + diff + " mult=" + mult + " diffEff=" + diffEff) +
          " dir=" + dir +
          " step=" + step +
          " carry=" + carry +
          " state=" + state.multiType +
          " -> angle=" + current,
      );
      carry = 0;

      // ── 中旋（真·三格写法，>2 押则叠加）：在原格之前依次插 [X₁,999,X₂,999,…]，
      //    原格角度不变。第 i 个折返角 sᵢ = i × 多押角度；travel_Xᵢ = sᵢ、
      //    travel_999 = 0、travel_原格 = T − Σsᵢ ⇒ 总 travel 不变，
      //    零净偏移、下游角度不变。主音（准时按下）压 X₁。
      if (isMultiBeat && state.multiType === "midspin" && j > 0) {
        var T = diffEff * 180;
        var presses = Math.min(pressCount, state.maxKeys); // 按最大押数截断
        var pairs = presses - 1;
        var sumS = (state.angle * pairs * (pairs + 1)) / 2; // Σ i×angle
        if (sumS > 0 && T - sumS >= DP_MIN_TRAVEL) {
          var partial = 0;
          for (var q = 1; q <= pairs; q++) {
            partial += state.angle * q;
            var xCurrent = wrap360(current + (T - partial)); // Xᵢ 折返格
            if (q === 1) beatFloor[j] = angleData.length; // 主音压 X₁
            angleData.push(dir * xCurrent);
            angleData.push(MIDSPIN); // 999：0 拍，与下一格同瞬间
          }
          angleData.push(dir * current); // 原格：角度不变，travel 被吃掉 Σsᵢ
          panelLog(
            "  (中旋插入) beat=" + beats[j] +
              " 押数=" + presses + " Σs=" + sumS + " T=" + T,
          );
          continue;
        }
        panelLog("  (中旋跳过：T=" + T + " 装不下 Σs=" + sumS + ") beat=" + beats[j]);
      }

      angleData.push(dir * current);
      beatFloor[j] = angleData.length - 1;

      // 多押（multi）：在原格之后插 min(押数, 最大押数) − 1 块。
      var blocks = 0;
      if (isMultiBeat && state.multiType === "multi") {
        blocks = Math.min(pressCount, state.maxKeys) - 1;
        if (blocks < 1) blocks = 1;
      }
      if (blocks > 0) {
        // 伪双押 / 伪多押统一理论：a = 押数；折返方向按当前走向取 s（走内圈 <180°）；
        // 插入 blocks 个折返块（每块转角 s·(180−angle)），末尾回落 s·angle·blocks。
        // Twirl 不在这里生成，统一由收尾按最终角度计算。
        var curAbs = dir * current; // 当前砖块（原格）方向
        var s = Math.cos((curAbs * Math.PI) / 180) >= 0 ? 1 : -1;
        for (var q = 0; q < blocks; q++) {
          current = wrap360(current + dir * s * (180 - state.angle));
          angleData.push(dir * current);
        }
        carry = s * state.angle * blocks; // 末尾回落 s·(a×blocks)
        stepSign = s; // 后续走向跟随折返方向
        panelLog(
          "  (多押) beat=" + beats[j] +
            " 押数=" + pressCount +
            " blocks=" + blocks +
            " angle=" + state.angle +
            " s=" + s,
        );
      }
    }
    // 发卡弯同号 + 闭环朝上：实验性启发式，默认关闭。
    // 开启后会整体改写 angleData（改变谱面形态），因此必须由用户显式启用。
    if (config.normalizeAngles) {
      // 收尾：把角度改成【连续不 wrap】，并让所有发卡弯（|转角|≈180°）强制同号。
      // 否则 0,180,0,180 在有符号转角下是 +180/-180 交替，游戏会把连续回头块按 1/2 拍交替播放。
      var hairpinSign = 0;
      for (var kk = 1; kk < angleData.length; kk++) {
        if (angleData[kk] === MIDSPIN || angleData[kk - 1] === MIDSPIN) continue;
        var dk = angleData[kk] - angleData[kk - 1];
        var sdk = (((dk % 360) + 540) % 360) - 180; // 归一到 (-180,180]
        if (Math.abs(Math.abs(sdk) - 180) < 0.5) {
          if (hairpinSign === 0) hairpinSign = sdk >= 0 ? 1 : -1;
          angleData[kk] = angleData[kk - 1] + hairpinSign * 180;
        } else {
          angleData[kk] = angleData[kk - 1] + sdk;
        }
      }

      // 恒定向上：折返/跑动常形成“闭环段”（段内累计转角回到同一朝向，如 +165,+105,+90=360）。
      // 段内所有转角取反 = 沿水平轴镜像，幅值不变（时序不变），把朝下的峰翻成朝上。
      // 实现：先把转角抽成 delta 表，在 delta 上取反，最后整条重建，
      // 避免“段尾平移”制造假转角（否则会一路放大成异形）。
      var mirrorDeltas = new Array(angleData.length);
      mirrorDeltas[0] = 0;
      for (var md = 1; md < angleData.length; md++) {
        mirrorDeltas[md] =
          angleData[md] === MIDSPIN || angleData[md - 1] === MIDSPIN
            ? null
            : angleData[md] - angleData[md - 1];
      }
      var mirrorAt = 1;
      while (mirrorAt < angleData.length) {
        if (mirrorDeltas[mirrorAt] === null) {
          mirrorAt++;
          continue;
        }
        var acc = 0;
        var segEnd = -1;
        for (var q = mirrorAt; q < angleData.length && q <= mirrorAt + 16; q++) {
          if (mirrorDeltas[q] === null) break;
          var dq = mirrorDeltas[q];
          if (Math.abs(dq) < 30) break; // 进入普通直行/整拍段
          acc += dq;
          var am = Math.abs(acc % 360);
          if (Math.abs(acc) >= 300 && (am < 1 || Math.abs(am - 360) < 1)) {
            segEnd = q;
            break;
          }
        }
        if (segEnd > mirrorAt) {
          // 用段内原始朝向判断是否整体朝下
          var sumSin = 0;
          var hv = angleData[mirrorAt - 1];
          for (var q2 = mirrorAt; q2 <= segEnd; q2++) {
            hv += mirrorDeltas[q2];
            sumSin += Math.sin(((hv % 360) * Math.PI) / 180);
          }
          if (sumSin < -1e-6) {
            for (var q3 = mirrorAt; q3 <= segEnd; q3++) mirrorDeltas[q3] = -mirrorDeltas[q3];
          }
          mirrorAt = segEnd + 1;
        } else {
          mirrorAt++;
        }
      }
      // 整条重建：连续、无假转角
      for (var rb = 1; rb < angleData.length; rb++) {
        if (mirrorDeltas[rb] === null) continue;
        angleData[rb] = angleData[rb - 1] + mirrorDeltas[rb];
      }
    }

    // ── Twirl 统一生成（按最终 angleData 计算，与用户期望文件逐 floor 完全一致）：
    //  维护“上一个显著转角（|Δ| ≥ 90°，即 8 分及更细）的符号”，初始 +1；
    //  当本次显著转角的符号与它不同时，在该块放一个 Twirl 并更新符号。
    //  发卡弯（|Δ|≈180°）不参与（Twirl 会让它反而不翻转）。
    dpTwirlFloors = [];
    if (config.doublePressTwirl) {
      var lastTwSign = 1;
      for (var ti = 1; ti < angleData.length; ti++) {
        if (angleData[ti] === MIDSPIN || angleData[ti - 1] === MIDSPIN) continue;
        var td = angleData[ti] - angleData[ti - 1];
        // 无论上面是否做了“连续不 wrap”，都先归一到 (-180,180] 再判断。
        var tdn = (((td % 360) + 540) % 360) - 180;
        var atd = Math.abs(tdn);
        if (atd >= 90 - 1e-6 && atd < 179.5) {
          var ts = tdn > 0 ? 1 : -1;
          if (ts !== lastTwSign) {
            dpTwirlFloors.push(ti);
            lastTwSign = ts;
          }
        }
      }
    }

    return { angleData: angleData, beatFloor: beatFloor, dpTwirlFloors: dpTwirlFloors };
  }

  // Pause 时长按拍计（引擎把 duration 看作等待拍数）。普通相邻块自占 1 拍，
  // 故填补有效间距 diffEff 需等待 diffEff − 1 拍。
  // 修复#2（默认关）：部分回头/大间隔谱面实测会多停 1 拍，开启后 dur > 2 时再减 1。
  function buildActions(beats, beatFloor, multAt, diffTable) {
    var actions = [];
    for (var j = 0; j < beats.length - 1; j++) {
      var diff = diffTable[j + 1];
      var mult = multAt(beats[j + 1]);
      var diffEff = diff * mult;
      if (diffEff > 2) {
        var dur = diffEff - 1;
        // 暂停数值修复#1：(1,2) 向上取整为 2，(2,3) 向下取整为 2。
        if (config.pauseFix1) {
          if (dur > 1 && dur < 2) dur = 2;
          else if (dur > 2 && dur < 3) dur = 2;
        }
        // 暂停拍数 > 2 时，实测可能多停 1 拍 → 可选减 1 拍（修复#2，默认关）。
        if (config.pauseFix2 && dur > 2) dur -= 1;
        actions.push({
          floor: beatFloor[j + 1],
          eventType: "Pause",
          duration: dur,
          countdownTicks: 0,
          angleCorrectionDir: "Backward",
        });
      }
    }
    return actions;
  }

  function buildSetSpeed(beats, beatFloor, bpmPoints, baseBpm, settings) {
    var arr = [];
    var idxByBeat = {};
    for (var i = 0; i < beats.length; i++) idxByBeat[beats[i]] = i;
    var bpm = baseBpm; // 累积当前 BPM，用于把倍频点的 beatsPerMinute 写成累积后的绝对值
    for (var k = 0; k < bpmPoints.length; k++) {
      var p = bpmPoints[k];
      bpm = p.type === "bpm" ? p.value : bpm * p.value;
      var floor = beatFloor[idxByBeat[p.beat]] + config.speedPlaceOffset;
      // floor ≤ 0 上的 SetSpeed 会被引擎忽略：改为写进 settings 的初始 BPM。
      if (floor <= 0) {
        settings.bpm = bpm;
        panelLog("  (初始BPM) beat=" + p.beat + " -> settings.bpm=" + bpm);
        continue;
      }
      arr.push({
        floor: floor,
        eventType: "SetSpeed",
        speedType: p.type === "bpm" ? "Bpm" : "Multiplier",
        beatsPerMinute: bpm,
        bpmMultiplier: p.type === "bpm" ? 1 : p.value,
        angleOffset: 0,
      });
    }
    return arr;
  }

  function buildTwirl(beats, beatFloor, twirlSet) {
    var arr = [];
    var idxByBeat = {};
    for (var i = 0; i < beats.length; i++) idxByBeat[beats[i]] = i;
    for (var b in twirlSet) {
      var f = beatFloor[idxByBeat[b]] + 1;
      arr.push({ floor: f, eventType: "Twirl" });
      panelLog("Twirl: floor " + f + " (beat " + b + " +1)");
    }
    return arr;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // 导出检查（仅提醒，不阻拦）①：某段 BPM 落在 (8×baseBpm, 16×baseBpm) 区间。
  function checkBpmRange(baseBpm, bpmPoints, beatFloor, idxByBeat) {
    var out = [];
    var bpm = baseBpm;
    for (var i = 0; i < bpmPoints.length; i++) {
      var p = bpmPoints[i];
      bpm = p.type === "bpm" ? p.value : bpm * p.value;
      var ratio = bpm / baseBpm;
      if (ratio > 8 && ratio < 16) {
        var idx = idxByBeat[p.beat];
        var floor = idx != null ? beatFloor[idx] + config.speedPlaceOffset : -1;
        out.push(
          "变速 beat " + p.beat + "（floor " + floor + "）：BPM " + round2(bpm) +
            "（" + round2(ratio) + "× 基准），处于 8×~16× 区间，请检查。",
        );
      }
    }
    return out;
  }

  // 导出检查（仅提醒，不阻拦）②：真·多押 beat 上的有效 travel 小于该点多押角度。
  //   travel = diffEff × 180（有效拍数 × 180°，直线 1 拍 = 180°；
  //   不能用 |180 − step|：diffEff 为偶数整拍时 step 会 wrap，得出假的 travel=0）。
  //   只在「当前状态是多押/中旋」且「该 beat 确实有 ≥2 个音砖」时检查——
  //   普通单押 beat 不插多押块，与其多押角度无关。
  //   连续异常段合并：距上次报警超过 1 拍才再报一次，每次只报该处当前的 travel（非累计）。
  function checkSmallAngles(beats, counts, beatFloor, multiPlan, multAt, diffTable) {
    var out = [];
    var state = { multiType: "single", maxKeys: 3, angle: 15 };
    var lastWarnBeat = null;
    for (var j = 0; j < beats.length; j++) {
      var mp = multiPlan[beats[j]];
      if (mp) state = { multiType: mp.multiType, maxKeys: mp.maxKeys, angle: mp.angle };
      if (j === 0) continue;
      var diff = diffTable[j];
      var mult = multAt(beats[j - 1]);
      var diffEff = diff * mult;
      var travel = diffEff * 180;
      var isMultiBeat = (counts[beats[j]] || 1) >= 2;
      if (state.multiType !== "single" && isMultiBeat && travel < state.angle - 1e-9) {
        if (lastWarnBeat === null || beats[j] - lastWarnBeat > 1) {
          out.push(
            "夹角 beat " + beats[j] + "（floor " + beatFloor[j] + "）：travel " +
              round2(travel) + "° < 多押角度 " + state.angle + "°，请检查。",
          );
          lastWarnBeat = beats[j];
        }
      }
    }
    return out;
  }


  // 按 ADOFAI v19 AddDecoration 的完整字段构造（缺字段会读取失败/行为异常）
  function makeDeco(floor, img, px, py, scale, color) {
    return {
      floor: floor,
      eventType: "AddDecoration",
      decorationImage: img,
      tag: "bdg_lane",
      position: [px, py],
      relativeTo: "Tile",
      stickToFloor: false,
      pivotOffset: [0, 0],
      rotation: 0,
      lockRotation: false,
      scale: [scale, scale],
      lockScale: false,
      tile: [1, 1],
      color: color,
      opacity: 100,
      depth: -1,
      syncFloorDepth: false,
      parallax: [0, 0],
      parallaxOffset: [0, 0],
      imageSmoothing: true,
      blendMode: "None",
      maskingType: "None",
      maskingTarget: "",
      useMaskingDepth: false,
      maskingFrontDepth: -1,
      maskingBackDepth: -1,
      hitbox: "None",
      hitboxTriggerType: "Once",
      hitboxRepeatInterval: 1000,
      hitboxEventTag: "",
      hitboxDetectTarget: "Planet",
      hitboxTargetPlanet: "Any",
      hitboxDecoTag: "",
      failHitboxType: "Box",
      failHitboxScale: [100, 100],
      failHitboxOffset: [0, 0],
      failHitboxRotation: 0,
      components: "",
    };
  }

  function buildDecorations(s, beatFloor, beats, angleData, bpb) {
    var decos = [];
    var acts = [];
    if (!config.fakeLanes) return { decorations: decos, actions: acts };
    var lineTracks = [];
    for (var t = 0; t < s.tracks.length; t++) {
      var tr = s.tracks[t];
      if (!tr || tr.hidden) continue;
      if (isBpmTrack(tr) || isMultiTrack(tr) || isTwirlTrack(tr)) continue;
      lineTracks.push(tr);
    }
    var n = lineTracks.length;
    if (!n || !beats.length) return { decorations: decos, actions: acts };

    var baseFloor = beatFloor[0] != null ? Math.max(1, beatFloor[0]) : 1;
    var firstBeat = beats[0];
    var totalBeats = Math.max(1e-6, beats[beats.length - 1] - firstBeat);

    // 一个四分音符（1 拍）对应的横向间隔：默认按工程总长自动选，让整段铺开约 80 格
    var spacingX =
      config.spacingX > 0
        ? config.spacingX
        : Math.max(0.2, Math.min(1.0, 80 / totalBeats));
    // 泳道纵向间隔
    var gapY = config.laneGap;
    // 所有泳道实际占用的高度（首末两条中心之间），再留一点上下余量
    var laneSpan = (n - 1) * gapY;
    var lineTiles = Math.max(0.3, laneSpan + 0.4);

    function xOfBeat(b) {
      return (b - firstBeat) * spacingX;
    }

    // 1) 每条轨道一条泳道：以中线对称，中心轨道（或中间两条的交界）在 y=0
    for (var li = 0; li < n; li++) {
      var lane = lineTracks[li];
      var laneY = (li - (n - 1) / 2) * gapY;
      var color = String(lane.color || "#ffffff").replace("#", "");
      var firstDone = false;
      for (var mi = 0; mi < s.markers.length; mi++) {
        var m = s.markers[mi];
        if (m.trackId !== lane.id) continue;
        var lx = xOfBeat(snapBeat(m.beat));
        decos.push(makeDeco(baseFloor, "bdg_lane_dot.png", lx, laneY, 22, color));
        if (!firstDone) {
          firstDone = true;
          decos.push(makeDeco(baseFloor, "bdg_lane_planet.png", lx, laneY, 34, color));
        }
      }
    }

    // 2) 小节线：从 firstBeat 所在小节起，纵向贯穿所有泳道，以 y=0 居中
    var lineScaleY = lineTiles * 100;
    var barStart = Math.floor(firstBeat / bpb) * bpb;
    var barEnd = firstBeat + totalBeats;
    for (var bb = barStart; bb <= barEnd + 0.001; bb += bpb) {
      var ln = makeDeco(baseFloor, "bdg_lane_line.png", xOfBeat(bb), 0, 40, "ffffff");
      ln.scale = [40, lineScaleY];
      ln.opacity = 26;
      decos.push(ln);
    }

    // 3) 播放头：只在第一块放一个装饰，并用【一条】MoveDecorations 线性移动到终点
    //    （与参考示例一致：duration = 总拍数，positionOffset = [最后一个菱形的 x, null]）
    var head = makeDeco(baseFloor, "bdg_lane_line.png", 0, 0, 40, "ff3b5c");
    head.tag = "bdg_playhead";
    head.scale = [60, lineScaleY];
    head.opacity = 95;
    head.depth = 5;
    decos.push(head);
    acts.push({
      floor: baseFloor,
      eventType: "MoveDecorations",
      duration: totalBeats,
      tag: "bdg_playhead",
      positionOffset: [totalBeats * spacingX, null],
      parallaxOffset: [null, null],
      angleOffset: 0,
      ease: "Linear",
      eventTag: "",
    });

    panelLog(
      "  装饰泳道：轨道 " + n + " 条，四分音符间隔 " + spacingX.toFixed(3) +
        " 格，装饰物 " + decos.length + " 个，播放头动作 " + acts.length + " 个",
    );
    return { decorations: decos, actions: acts };
  }

  // ---- 素材生成：纯 JS 输出 PNG（不依赖任何库） ----
  function crc32(buf) {
    var table = crc32.t;
    if (!table) {
      table = crc32.t = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function adler32(buf) {
    var a = 1, b = 0;
    for (var i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }
  function pngChunk(type, data) {
    var len = new Uint8Array(4);
    len[0] = (data.length >>> 24) & 255;
    len[1] = (data.length >>> 16) & 255;
    len[2] = (data.length >>> 8) & 255;
    len[3] = data.length & 255;
    var body = new Uint8Array(4 + data.length);
    for (var i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    var out = new Uint8Array(4 + body.length + 4);
    out.set(len, 0);
    out.set(body, 4);
    var c = crc32(body);
    out[out.length - 4] = (c >>> 24) & 255;
    out[out.length - 3] = (c >>> 16) & 255;
    out[out.length - 2] = (c >>> 8) & 255;
    out[out.length - 1] = c & 255;
    return out;
  }
  // 生成 w×h 的 RGBA PNG（deflate 用 stored 块，无需 zlib）
  function encodePng(w, h, rgba) {
    var raw = new Uint8Array(h * (w * 4 + 1));
    for (var y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
    }
    var blocks = [new Uint8Array([0x78, 0x01])];
    var pos = 0;
    while (pos < raw.length) {
      var len = Math.min(65535, raw.length - pos);
      var last = pos + len >= raw.length ? 1 : 0;
      var bh = new Uint8Array(5 + len);
      bh[0] = last;
      bh[1] = len & 255;
      bh[2] = (len >>> 8) & 255;
      bh[3] = ~len & 255;
      bh[4] = (~len >>> 8) & 255;
      bh.set(raw.subarray(pos, pos + len), 5);
      blocks.push(bh);
      pos += len;
    }
    var ad = adler32(raw);
    blocks.push(new Uint8Array([(ad >>> 24) & 255, (ad >>> 16) & 255, (ad >>> 8) & 255, ad & 255]));
    var total = 0;
    for (var b = 0; b < blocks.length; b++) total += blocks[b].length;
    var z = new Uint8Array(total);
    var off = 0;
    for (var b2 = 0; b2 < blocks.length; b2++) {
      z.set(blocks[b2], off);
      off += blocks[b2].length;
    }
    var ihdr = new Uint8Array(13);
    ihdr[0] = (w >>> 24) & 255; ihdr[1] = (w >>> 16) & 255; ihdr[2] = (w >>> 8) & 255; ihdr[3] = w & 255;
    ihdr[4] = (h >>> 24) & 255; ihdr[5] = (h >>> 16) & 255; ihdr[6] = (h >>> 8) & 255; ihdr[7] = h & 255;
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var parts = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", z),
      pngChunk("IEND", new Uint8Array(0)),
    ];
    var sz = 0;
    for (var p = 0; p < parts.length; p++) sz += parts[p].length;
    var png = new Uint8Array(sz);
    var o = 0;
    for (var p2 = 0; p2 < parts.length; p2++) { png.set(parts[p2], o); o += parts[p2].length; }
    return png;
  }
  function diamondPng(size) {
    var rgba = new Uint8Array(size * size * 4);
    var c = (size - 1) / 2;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var d = (Math.abs(x - c) + Math.abs(y - c)) / (size * 0.46);
        var i = (y * size + x) * 4;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
        rgba[i + 3] = d <= 1 ? 235 : d <= 1.1 ? Math.round((1.1 - d) / 0.1 * 235) : 0;
      }
    }
    return encodePng(size, size, rgba);
  }
  function planetPng(size) {
    var rgba = new Uint8Array(size * size * 4);
    var c = (size - 1) / 2;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var r = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / (size * 0.5);
        var a = r <= 0.42 ? 1 : r >= 1 ? 0 : (1 - r) / 0.58 * 0.85;
        var i = (y * size + x) * 4;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
        rgba[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    return encodePng(size, size, rgba);
  }

  // 竖线素材（白色细条，可拉伸/染色）
  function linePng(size) {
    var rgba = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = (y * size + x) * 4;
        var edge = Math.abs(x - (size - 1) / 2) <= 2 ? 1 : 0;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
        rgba[i + 3] = edge ? 255 : 0;
      }
    }
    return encodePng(size, size, rgba);
  }


  function buildLevel() {
    var s = api.project.snapshot();
    var baseBpm = s.baseBpm;
    var settings = {};
    for (var k in DEFAULT_SETTINGS) settings[k] = DEFAULT_SETTINGS[k];
    settings.songFilename = s.audioName || "";
    settings.bpm = baseBpm;
    settings.offset = Math.round(s.offsetMs);

    var scan = scanBeats(s);
    var beats = scan.beats;
    var counts = scan.counts;
    var beatSet = {};
    for (var i = 0; i < beats.length; i++) beatSet[beats[i]] = true;

    var bpmPoints = readBpmPoints(s);
    for (var v = 0; v < bpmPoints.length; v++) {
      if (!(bpmPoints[v].beat in beatSet)) {
        return { error: "BPM 点 beat " + bpmPoints[v].beat + " 未落在 marker 上，拒绝导出。" };
      }
    }

    // 累积计算当前 BPM：从 baseBpm 起，依次套用每个点——
    //   「BPM值」= 绝对重置；「倍频」= 乘在当前 BPM 上（连续两个 2 倍频 => ×4）。
    function bpmAt(beat) {
      var bpm = baseBpm;
      for (var q = 0; q < bpmPoints.length; q++) {
        var p = bpmPoints[q];
        if (p.beat <= beat) bpm = p.type === "bpm" ? p.value : bpm * p.value;
        else break;
      }
      return bpm;
    }
    // 相对 baseBpm 的倍率（角度 / Pause 换算用）
    function multAt(beat) {
      return bpmAt(beat) / baseBpm;
    }

    var twirlSet = readTwirlSet(s);
    for (var b in twirlSet) {
      if (!(b in beatSet)) {
        return { error: "旋转点 beat " + b + " 未落在 marker 上，拒绝导出。" };
      }
    }

    var multiPlan = readMultiPress(s);
    for (var bb in multiPlan) {
      if (!(bb in beatSet)) {
        return { error: "多押点 beat " + bb + " 未落在 marker 上，拒绝导出。" };
      }
    }

    var _bpmLog = baseBpm;
    for (var pp = 0; pp < bpmPoints.length; pp++) {
      _bpmLog = bpmPoints[pp].type === "bpm" ? bpmPoints[pp].value : _bpmLog * bpmPoints[pp].value;
      panelLog(
        "  BPM点 beat=" + bpmPoints[pp].beat +
          " type=" + bpmPoints[pp].type +
          " value=" + bpmPoints[pp].value +
          " -> bpm=" + _bpmLog +
          " mult=" + _bpmLog / baseBpm,
      );
    }
    for (var mb in multiPlan) {
      var m0 = multiPlan[mb];
      panelLog(
        "  多押点 beat=" + mb +
          " 类型=" + m0.multiType +
          " 最大押数=" + m0.maxKeys +
          " 角度=" + m0.angle,
      );
    }

    var diffTable = buildDiffTable(beats);
    // 自动 Twirl 与手动 Twirl 互斥：自动规则基于最终 angleData 计算，
    // 若同时计入手动 Twirl 会重复翻转，因此开启自动时忽略手动 Twirl 轨道。
    var autoTwirl = !!config.doublePressTwirl;
    var built = buildAngleData(
      beats, counts, multiPlan, multAt,
      autoTwirl ? null : twirlSet,
      diffTable,
    );
    var actions = buildActions(beats, built.beatFloor, multAt, diffTable);
    actions = actions.concat(buildSetSpeed(beats, built.beatFloor, bpmPoints, baseBpm, settings));
    if (!autoTwirl) {
      actions = actions.concat(buildTwirl(beats, built.beatFloor, twirlSet));
    }
    if (autoTwirl) {
      for (var dp = 0; dp < built.dpTwirlFloors.length; dp++) {
        actions.push({ floor: built.dpTwirlFloors[dp], eventType: "Twirl" });
        panelLog("Twirl(自动): floor " + built.dpTwirlFloors[dp]);
      }
    }
    // 装饰泳道（含小节线 / 播放头动作）；小节默认 4 拍
    var decoPack = buildDecorations(s, built.beatFloor, beats, built.angleData, 4);
    actions = actions.concat(decoPack.actions);
    actions.sort(function (a, b) {
      if (a.floor !== b.floor) return a.floor - b.floor;
      var order = { SetSpeed: 0, Twirl: 1, Pause: 2, MoveDecorations: 3 };
      var oa = order[a.eventType];
      var ob = order[b.eventType];
      if (oa == null) oa = 99;
      if (ob == null) ob = 99;
      return oa - ob;
    });

    var idxByBeat = {};
    for (var bi = 0; bi < beats.length; bi++) idxByBeat[beats[bi]] = bi;
    var warnings = [];
    if (autoTwirl && Object.keys(twirlSet).length) {
      warnings.push("自动 Twirl 已开启：手动 Twirl 轨道被忽略");
    }
    warnings = warnings.concat(checkBpmRange(baseBpm, bpmPoints, built.beatFloor, idxByBeat));
    warnings = warnings.concat(
      checkSmallAngles(beats, counts, built.beatFloor, multiPlan, multAt, diffTable),
    );

    return {
      obj: {
        angleData: built.angleData,
        settings: settings,
        actions: actions,
        decorations: decoPack.decorations,
      },
      warnings: warnings,
    };
  }

  var logEl = null;

  function panelLog(msg) {
    api.log(msg);
  }

  function doExport() {
    var level = buildLevel();
    if (level.error) {
      api.log("adofai export refused:", level.error);
      api.ui.notify({
        message: "导出被拒绝：" + level.error,
        type: "error",
      });
      return;
    }
    if (level.warnings && level.warnings.length) {
      for (var wi = 0; wi < level.warnings.length; wi++) {
        api.log("adofai warn: " + level.warnings[wi]);
      }
      var shown = level.warnings.slice(0, 20);
      var msg = "导出检查（仅提醒，不阻拦导出）：" + shown.join("；");
      if (level.warnings.length > shown.length) {
        msg += "；另有 " + (level.warnings.length - shown.length) + " 处，详见日志。";
      }
      api.ui.notify({ message: msg, type: "warning", durationMs: 8000 });
    }
    var content = JSON.stringify(level.obj, null, 2);
    var savedPath = null;
    api.system
      .saveFile({
        title: "Export as ADOFAI level",
        defaultPath: "level.adofai",
        filters: [{ name: "ADOFAI level", extensions: ["adofai"] }],
      })
      .then(function (res) {
        if (res.canceled || !res.filePath) return null;
        savedPath = res.filePath;
        return api.system.writeText(res.filePath, content);
      })
      .then(function (ok) {
        if (!ok || !savedPath) return;
        api.log("adofai export:", "saved");
        // 装饰素材写到关卡同目录（decorationImage 按关卡目录解析）
        var dir = String(savedPath).replace(/[\\/][^\\/]*$/, "");
        if (!config.fakeLanes) return;
        return Promise.all([
          api.system.writeBytes(dir + "/bdg_lane_dot.png", diamondPng(64)),
          api.system.writeBytes(dir + "/bdg_lane_planet.png", planetPng(64)),
          api.system.writeBytes(dir + "/bdg_lane_line.png", linePng(64)),
        ]).then(function (results) {
          if (results.some(function (r) { return !r; })) {
            api.log("adofai export: lane png write returned false");
            api.ui.notify({
              message: "装饰素材写入失败，关卡中的图片可能缺失。",
              type: "warning",
              durationMs: 8000,
            });
            return;
          }
          api.log("adofai export: lane png written");
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        api.log("adofai export: failed", msg);
        api.ui.notify({ message: "导出失败：" + msg, type: "error" });
      });
  }

  // ---------------- 轨道类型注册 ----------------

  api.trackTypes.register({
    id: "bpm",
    trackName: { zh: "ADOFAI BPM 轨道", en: "ADOFAI BPM Track" },
    pointName: { zh: "BPM 点", en: "BPM Point" },
    color: "#ca8a04",
    fields: [
      {
        key: "speedType",
        label: { zh: "类型", en: "Type" },
        type: "enum",
        default: "multiplier",
        options: [
          { value: "multiplier", label: { zh: "倍频", en: "Multiplier" } },
          { value: "bpm", label: { zh: "BPM 值", en: "BPM" } },
        ],
      },
      {
        key: "value",
        label: { zh: "值", en: "Value" },
        type: "number",
        default: 1,
      },
    ],
  });

  // 多押轨道：踩点 attrs（类型/最大押数/角度）驱动该位置及之后的多押生成。当前块保留，
  // 其后插 (180−角度) 的块，再以 carry 补回 +角度。
  api.trackTypes.register({
    id: "multi",
    trackName: { zh: "多押轨道", en: "Multi-press Track" },
    pointName: { zh: "多押点", en: "Multi-press" },
    color: "#f59e0b",
    fields: [
      {
        key: "multiType",
        label: { zh: "多押类型", en: "Type" },
        type: "enum",
        default: "single",
        options: [
          { value: "single", label: { zh: "单轨", en: "Single" } },
          { value: "midspin", label: { zh: "中旋", en: "Midspin" } },
          { value: "multi", label: { zh: "多押", en: "Multi" } },
        ],
      },
      {
        key: "maxKeys",
        label: { zh: "最大押数", en: "Max keys" },
        type: "number",
        default: 3,
        min: 2,
        max: 8,
      },
      {
        key: "angle",
        label: { zh: "多押角度", en: "Angle" },
        type: "enum",
        default: 15,
        options: [
          { value: 1, label: "1°" },
          { value: 5, label: "5°" },
          { value: 15, label: "15°" },
          { value: 22.5, label: "22.5°" },
          { value: 30, label: "30°" },
        ],
      },
    ],
  });

  // 旋转轨道已从 UI 移除（不再可创建），内部 Twirl 生成逻辑保留。

  // ---------------- 面板：导出设置 ----------------

  function panelRow(labelText, control) {
    var row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.margin = "6px 0";
    var span = document.createElement("span");
    span.textContent = labelText;
    span.style.flex = "1";
    row.appendChild(span);
    row.appendChild(control);
    return row;
  }

  api.ui.registerPanel({
    id: "adofai-config",
    title: { zh: "ADOFAI 导出设置", en: "ADOFAI Export Options" },
    mount: function mount(host) {
      host.textContent = "";

      var wrap = document.createElement("div");
      wrap.style.padding = "4px 2px";
      host.appendChild(wrap);

      var offsetInput = document.createElement("input");
      offsetInput.type = "number";
      offsetInput.step = "1";
      offsetInput.value = String(config.speedPlaceOffset);
      offsetInput.style.width = "72px";
      offsetInput.addEventListener("change", function () {
        var v = parseFloat(offsetInput.value);
        config.speedPlaceOffset = isNaN(v) ? 0 : v;
        offsetInput.value = String(config.speedPlaceOffset);
        saveConfig();
        api.log("adofai: speedPlaceOffset ->", config.speedPlaceOffset);
      });
      wrap.appendChild(panelRow("变速放置位置偏移 (floor)", offsetInput));

      var pauseFix = document.createElement("input");
      pauseFix.type = "checkbox";
      pauseFix.checked = config.pauseFix1;
      pauseFix.addEventListener("change", function () {
        config.pauseFix1 = pauseFix.checked;
        saveConfig();
        api.log("adofai: pauseFix1 ->", config.pauseFix1);
      });
      wrap.appendChild(panelRow("暂停数值修复#1", pauseFix));

      var pauseFix2 = document.createElement("input");
      pauseFix2.type = "checkbox";
      pauseFix2.checked = config.pauseFix2;
      pauseFix2.addEventListener("change", function () {
        config.pauseFix2 = pauseFix2.checked;
        saveConfig();
        api.log("adofai: pauseFix2 ->", config.pauseFix2);
      });
      wrap.appendChild(panelRow("暂停数值修复#2（修复#1 后仍 dur>2 则减 1 拍）", pauseFix2));

      var rapidToggle = document.createElement("input");
      rapidToggle.type = "checkbox";
      rapidToggle.checked = config.rapidRuns;
      rapidToggle.addEventListener("change", function () {
        config.rapidRuns = rapidToggle.checked;
        saveConfig();
        api.log("adofai: rapidRuns ->", config.rapidRuns);
      });
      wrap.appendChild(panelRow("快速跑动形态（测试）", rapidToggle));

      var dpTwirlToggle = document.createElement("input");
      dpTwirlToggle.type = "checkbox";
      dpTwirlToggle.checked = config.doublePressTwirl;
      dpTwirlToggle.addEventListener("change", function () {
        config.doublePressTwirl = dpTwirlToggle.checked;
        saveConfig();
        api.log("adofai: doublePressTwirl ->", config.doublePressTwirl);
      });
      wrap.appendChild(panelRow("自动 Twirl（测试）", dpTwirlToggle));

      var snapToggle = document.createElement("input");
      snapToggle.type = "checkbox";
      snapToggle.checked = config.snapNearInt;
      snapToggle.addEventListener("change", function () {
        config.snapNearInt = snapToggle.checked;
        saveConfig();
        api.log("adofai: snapNearInt ->", config.snapNearInt);
      });
      wrap.appendChild(panelRow("近整拍吸附（测试）", snapToggle));

      var normToggle = document.createElement("input");
      normToggle.type = "checkbox";
      normToggle.checked = config.normalizeAngles;
      normToggle.addEventListener("change", function () {
        config.normalizeAngles = normToggle.checked;
        saveConfig();
        api.log("adofai: normalizeAngles ->", config.normalizeAngles);
      });
      wrap.appendChild(panelRow("发卡弯同号 / 闭环朝上（测试）", normToggle));

      var lanesToggle = document.createElement("input");
      lanesToggle.type = "checkbox";
      lanesToggle.checked = config.fakeLanes;
      lanesToggle.addEventListener("change", function () {
        config.fakeLanes = lanesToggle.checked;
        saveConfig();
        api.log("adofai: fakeLanes ->", config.fakeLanes);
      });
      wrap.appendChild(panelRow("生成装饰泳道（默认关）", lanesToggle));

      var gapInput = document.createElement("input");
      gapInput.type = "number";
      gapInput.step = "0.1";
      gapInput.min = "0.2";
      gapInput.value = String(config.laneGap);
      gapInput.style.width = "72px";
      gapInput.addEventListener("change", function () {
        var v = parseFloat(gapInput.value);
        config.laneGap = isNaN(v) ? 1.5 : v;
        gapInput.value = String(config.laneGap);
        saveConfig();
        api.log("adofai: laneGap ->", config.laneGap);
      });
      wrap.appendChild(panelRow("泳道间距 (格)", gapInput));

      var spInput = document.createElement("input");
      spInput.type = "number";
      spInput.step = "0.05";
      spInput.min = "0";
      spInput.value = String(config.spacingX);
      spInput.style.width = "72px";
      spInput.addEventListener("change", function () {
        var v = parseFloat(spInput.value);
        config.spacingX = isNaN(v) || v < 0 ? 0 : v;
        spInput.value = String(config.spacingX);
        saveConfig();
        api.log("adofai: spacingX ->", config.spacingX);
      });
      wrap.appendChild(panelRow("四分音符间隔 (格，0=自动)", spInput));

      var hint = document.createElement("div");
      hint.style.opacity = "0.6";
      hint.style.fontSize = "12px";
      hint.style.marginTop = "8px";
      hint.textContent =
        "偏移：SetSpeed 的 floor 相加（正数往后挪格）；修复#1：暂停 (1,2)→2、(2,3)→2；" +
        "修复#2：修复#1 后仍 > 2 拍时再减 1 拍；" +
        "自动 Twirl：开启后按最终 angleData 生成，并忽略手动 Twirl 轨道；" +
        "快速跑动：8 分三角、6 分三角、16/32 分之字、12/24 分同号；" +
        "装饰泳道：按轨道颜色生成菱形 + 行星，另含小节线与红色播放头（1 拍 = 1 格）；" +
        "泳道间距越小越紧凑（默认 0.5 格）。" +
        "近整拍吸附：拍差距整数 ≤ 0.05 时按整拍计算，消除几度的弯曲。" +
        "发卡弯同号 / 闭环朝上：把发卡弯统一同号并镜像朝下的闭环段（会改变形态）。";
      wrap.appendChild(hint);

      return function unmount() {
        host.textContent = "";
      };
    },
  });

  // ---------------- 面板：多轨预览（仿 AdofaiMappingHelper 的多轨道生成） ----------------
  // 每条轨道一条泳道；踩点画菱形；竖线为小节线；红线为播放头；随播放实时滚动。
  // 时间→x 直接使用宿主 timeline 的 pxPerSec，保证与主时间轴缩放一致。
  var lanesPanel = api.ui.registerPanel({
    id: "adofai-lanes",
    title: { zh: "多轨预览", en: "Multi-track Preview" },
    defaultWidth: 760,
    defaultHeight: 380,
    mount: function mountLanes(host) {
      host.textContent = "";
      var wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;height:100%;gap:4px";
      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;gap:10px;font-size:12px;opacity:.85";
      var followLabel = document.createElement("label");
      followLabel.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer";
      var followBox = document.createElement("input");
      followBox.type = "checkbox";
      followBox.checked = true;
      followLabel.appendChild(followBox);
      followLabel.appendChild(document.createTextNode("跟随播放"));
      var barInput = document.createElement("input");
      barInput.type = "number";
      barInput.min = "1";
      barInput.step = "1";
      barInput.value = "4";
      barInput.style.width = "52px";
      var barLabel = document.createElement("label");
      barLabel.style.cssText = "display:flex;align-items:center;gap:4px";
      barLabel.appendChild(document.createTextNode("每小节拍数"));
      barLabel.appendChild(barInput);
      bar.appendChild(followLabel);
      bar.appendChild(barLabel);

      // 局部缩放（相对主时间轴的 pxPerSec）
      function mkBtn(txt) {
        var bt = document.createElement("button");
        bt.type = "button";
        bt.textContent = txt;
        bt.style.cssText =
          "min-width:22px;height:20px;border-radius:4px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:inherit;cursor:pointer;font-size:12px;line-height:1";
        return bt;
      }
      var zoomOut = mkBtn("－");
      var zoomIn = mkBtn("＋");
      var zoomTxt = document.createElement("span");
      zoomTxt.style.cssText = "min-width:38px;text-align:center;opacity:.7";
      var zoomMul = 1;
      function applyZoom() {
        zoomMul = Math.max(0.1, Math.min(8, zoomMul));
        zoomTxt.textContent = Math.round(zoomMul * 100) + "%";
      }
      zoomOut.addEventListener("click", function () {
        zoomMul /= 1.25;
        applyZoom();
      });
      zoomIn.addEventListener("click", function () {
        zoomMul *= 1.25;
        applyZoom();
      });
      applyZoom();
      bar.appendChild(zoomOut);
      bar.appendChild(zoomTxt);
      bar.appendChild(zoomIn);

      wrap.appendChild(bar);

      var cv = document.createElement("canvas");
      cv.style.cssText = "flex:1;min-height:0;width:100%;display:block;border-radius:6px";
      wrap.appendChild(cv);
      host.appendChild(wrap);

      var raf = 0;
      var scrollPx = 0; // 左边缘对应的时间（px）
      var inited = false;
      var cache = null;
      var cacheAt = 0;

      var cvW = 0;
      var cvH = 0;
      function fit() {
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, cv.clientWidth);
        var h = cv.clientHeight > 40 ? cv.clientHeight : 240; // 面板未定型时兜底
        var ctx = cv.getContext("2d");
        // 仅在尺寸变化时重建画布（每帧重置会清屏并带来额外开销）
        if (w !== cvW || h !== cvH) {
          cvW = w;
          cvH = h;
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return { ctx: ctx, w: w, h: h };
      }

      // 轨道/踩点/小节线的时间只算一次（每 500ms 或项目变动时刷新），逐帧只做坐标变换。
      function buildCache() {
        var snap = api.project.snapshot();
        var tracks = [];
        for (var i = 0; i < snap.tracks.length; i++) {
          if (!snap.tracks[i].hidden) tracks.push(snap.tracks[i]);
        }
        var laneOf = {};
        for (var li = 0; li < tracks.length; li++) laneOf[tracks[li].id] = li;

        var pts = [];
        for (var mi = 0; mi < snap.markers.length; mi++) {
          var m = snap.markers[mi];
          if (!(m.trackId in laneOf)) continue;
          pts.push({ lane: laneOf[m.trackId], ms: api.project.timeOfBeat(m.beat) });
        }

        var bpb = Math.max(1, Math.floor(Number(barInput.value) || 4));
        var endMs = api.player.durationMs() || 0;
        if (pts.length) {
          var last = pts[pts.length - 1].ms;
          if (last > endMs) endMs = last;
        }
        var bars = [];
        var endBeat = Math.max(0, Math.ceil(api.project.beatOfTime(endMs)) + bpb);
        for (var b = 0; b <= endBeat; b += bpb) {
          bars.push({ beat: b, ms: api.project.timeOfBeat(b) });
        }
        cache = { tracks: tracks, pts: pts, bars: bars, bpb: bpb };
        cacheAt = performance.now();
      }

      function frame() {
        raf = 0;
        var vp = api.timeline.viewport();
        var pxPerSec = (vp.pxPerSec > 1 ? vp.pxPerSec : 120) * zoomMul;
        var posMs = api.player.positionMs();
        var f = fit();
        var ctx = f.ctx, W = f.w, H = f.h;

        if (!cache || performance.now() - cacheAt > 500) buildCache();
        var tracks = cache.tracks;
        var laneH = tracks.length
          ? Math.max(18, Math.min(44, (H - 26) / tracks.length))
          : 24;
        var top = 18;

        // 跟随：播放头保持在 28% 处（平滑）；不跟随时保持当前滚动位置
        var targetScroll = (posMs / 1000) * pxPerSec - W * 0.28;
        if (!inited) {
          scrollPx = targetScroll;
          inited = true;
        } else if (followBox.checked) {
          scrollPx += (targetScroll - scrollPx) * 0.22;
        }

        var x0 = scrollPx; // 时间 0 的 x 偏移
        function timeToX(ms) {
          return (ms / 1000) * pxPerSec - x0;
        }

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, H);

        for (var li2 = 0; li2 < tracks.length; li2++) {
          ctx.fillStyle =
            li2 % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.015)";
          ctx.fillRect(0, top + li2 * laneH, W, laneH - 1);
        }

        // 小节线 + 小节序号
        ctx.font = "10px sans-serif";
        for (var bi = 0; bi < cache.bars.length; bi++) {
          var bx = timeToX(cache.bars[bi].ms);
          if (bx < -2 || bx > W + 2) continue;
          ctx.fillStyle = "rgba(255,255,255,0.30)";
          ctx.fillRect(Math.round(bx), top, 1, tracks.length * laneH);
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillText(String(cache.bars[bi].beat / cache.bpb + 1), Math.round(bx) + 3, 11);
        }

        // 踩点（菱形）
        for (var pi = 0; pi < cache.pts.length; pi++) {
          var p = cache.pts[pi];
          var mx = timeToX(p.ms);
          if (mx < -8 || mx > W + 8) continue;
          var my = top + p.lane * laneH + laneH / 2;
          var r = Math.min(7, laneH * 0.28);
          ctx.fillStyle = tracks[p.lane].color || "#e5c07b";
          ctx.beginPath();
          ctx.moveTo(mx, my - r);
          ctx.lineTo(mx + r, my);
          ctx.lineTo(mx, my + r);
          ctx.lineTo(mx - r, my);
          ctx.closePath();
          ctx.fill();
        }

        // 播放头
        ctx.fillStyle = "#ff3b5c";
        ctx.fillRect(Math.round(timeToX(posMs)), 0, 2, H);

        // 轨道名
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        for (var lj = 0; lj < tracks.length; lj++) {
          ctx.fillText(
            String(tracks[lj].name || "Track").slice(0, 14),
            6,
            top + lj * laneH + laneH / 2 + 3,
          );
        }

        raf = requestAnimationFrame(frame);
      }

      raf = requestAnimationFrame(frame);

      return function unmountLanes() {
        cancelAnimationFrame(raf);
        raf = 0;
        host.textContent = "";
      };
    },
  });

  // 快捷按钮：一键打开/关闭多轨预览
  if (api.ui.registerBarButton) {
    api.ui.registerBarButton({
      id: "adofai-lanes-btn",
      title: { zh: "多轨预览", en: "Lanes" },
      order: 60,
      run: function () {
        if (lanesPanel) lanesPanel.toggle();
      },
    });
  }

  // ---------------- 出口：导出按钮 ----------------

  api.ui.registerExporter({
    label: { zh: "ADOFAI 关卡 (.adofai)", en: "ADOFAI level (.adofai)" },
    run: doExport,
  });

  api.log("contributions registered");

  return function dispose() {
    api.log("renderer entry disposed");
  };
});
