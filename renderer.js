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
  // ≤ tolerance 拍的拍差；1/2、1/3、1/4 等正常细分距整数远，不受影响。
  function snapDiff(diff, tolerance) {
    var r = Math.round(diff);
    if (r < 1) return diff; // 不把 <0.5 的拍差吸成 0
    var delta = Math.abs(diff - r);
    if (delta > tolerance || delta < 1e-9) return diff;
    return r;
  }

  // 绝对拍位吸附（新版模型 / snapNearInt 开启时）：拍位置靠近整数、且不在工程
  // 网格上时直接吸到整数拍。只吸「拍差」不够——像 640.9668 这种离 641 只差
  // 0.03 拍的杂点，自身拍差会被吸成 1，但下一个拍差变成 0.03，生成接近回头的
  // 174° 小弯。先把拍位置本身吸到 641，两个拍会自然合并。
  function snapBeatPos(v, tolerance, gridDiv) {
    var r = Math.round(v);
    var d = Math.abs(v - r);
    if (d > tolerance || d < 1e-9) return v;
    if (gridDiv > 0) {
      var k = v * gridDiv;
      if (Math.abs(k - Math.round(k)) < 1e-6) return v; // 合法网格位置
    }
    return r;
  }

  // 读取各类轨道点时统一走的 beat 归一：先 1e-6 去重，新版模型再按 opts 做绝对拍位吸附。
  function readBeat(s, v, opts) {
    var b = snapBeat(v);
    if (opts && opts.snapNearInt) {
      b = snapBeatPos(b, opts.snapTolerance, Number(s.gridDiv) || 0);
    }
    return b;
  }

  // 逐拍差只算一次：角度、Pause、夹角检查共用同一份吸附结果，日志也只记一次。
  // trackCfg 是“当前核心模型实际生效”的配置：旧版模型会强制关闭吸附等轨道启发式。
  // timeOfBeat 非空时（新版模型）：逐拍差改用工程 tempo map 的真实时间差，
  //   换算成「基础拍」——这样音频变速时导出的砖不会按等拍网格累积漂移。
  function buildDiffTable(beats, trackCfg, timeOfBeat) {
    var out = new Array(beats.length);
    out[0] = 0;
    for (var j = 1; j < beats.length; j++) {
      var raw = timeOfBeat
        ? timeOfBeat(beats[j]) - timeOfBeat(beats[j - 1])
        : beats[j] - beats[j - 1];
      var snapped = trackCfg.snapNearInt
        ? snapDiff(raw, trackCfg.snapTolerance)
        : raw;
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

  var bpmKey = api.id + ":bpm";
  var multiKey = api.id + ":multi";
  var twirlKey = api.id + ":twirl";

  // 面板设置：按插件隔离、主进程落盘的 api.storage。
  // 核心模型只控制 3 处互相冲突的行为（多押折返方向、dir/effSign 步进、Twirl 来源），
  // 其余新功能都是独立开关，默认值对齐旧版，避免升级后静默改谱。
  var CONFIG_KEY = "config";
  var CONFIG_VERSION = 3;

  function defaultConfig() {
    return {
      configVersion: CONFIG_VERSION,
      coreModel: "legacy", // "legacy"(0.2 行为) | "modern"(0.3 行为)
      speedPlaceOffset: 1,
      pauseFix1: true,
      pauseFix2: false,
      snapNearInt: false,
      snapTolerance: 0.05,
      rapidRuns: false,
      normalizeAngles: false,
      twirlMode: "manual", // "manual" | "auto" | "off"
      legacyDoubleTwirl: false, // 仅 legacy 生效，等价 0.2 的“双押旋转”
      multiTurn: "auto", // "auto" | "inner" | "outer"（modern）
      fakeLanes: false,
      laneGap: 0.5,
      spacingX: 0,
      barBeats: 4,
      showChecks: true,
      autoTwirlThreshold: 90,
      hairpinExclude: 179.5,
    };
  }

  function loadConfig() {
    var d = defaultConfig();
    var raw = api.storage.get(CONFIG_KEY, null);
    if (!raw || typeof raw !== "object") return d;

    var cfg = {};
    for (var k in d) {
      if (k in raw && typeof raw[k] === typeof d[k]) cfg[k] = raw[k];
      else cfg[k] = d[k];
    }

    if (typeof cfg.speedPlaceOffset !== "number") cfg.speedPlaceOffset = 1;
    cfg.laneGap = cfg.laneGap > 0 ? cfg.laneGap : 0.5;
    cfg.spacingX = cfg.spacingX >= 0 ? cfg.spacingX : 0;
    cfg.barBeats =
      cfg.barBeats >= 1 ? Math.floor(cfg.barBeats) : 4;
    cfg.snapTolerance =
      cfg.snapTolerance >= 0 ? cfg.snapTolerance : 0.05;
    if (cfg.coreModel !== "modern") cfg.coreModel = "legacy";
    if (cfg.twirlMode !== "manual" && cfg.twirlMode !== "auto" && cfg.twirlMode !== "off") {
      cfg.twirlMode = "manual";
    }
    if (cfg.multiTurn !== "auto" && cfg.multiTurn !== "inner" && cfg.multiTurn !== "outer") {
      cfg.multiTurn = "auto";
    }

    // 旧配置无版本号：0.3 会写出 snapNearInt / pauseFix2 等新键，据此区分来源。
    // 无法判断时默认 legacy，保证“升级不改谱”。
    if (!raw.configVersion) {
      var looksModern =
        "snapNearInt" in raw ||
        "pauseFix2" in raw ||
        "rapidRuns" in raw ||
        "normalizeAngles" in raw ||
        "fakeLanes" in raw;
      var doublePressTwirl = raw.doublePressTwirl === true;
      cfg.coreModel = looksModern ? "modern" : "legacy";
      cfg.twirlMode = looksModern
        ? (doublePressTwirl ? "auto" : "manual")
        : "manual";
      cfg.legacyDoubleTwirl = !looksModern && doublePressTwirl;
      cfg.configVersion = CONFIG_VERSION;
      api.storage.set(CONFIG_KEY, cfg);
    }
    return cfg;
  }

  var config = loadConfig();
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
  function scanBeats(s, opts) {
    var counts = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isBpmTrack(track) || isMultiTrack(track)) continue;
      var beat = readBeat(s, m.beat, opts);
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
  function readMultiPress(s, opts) {
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
      plan[readBeat(s, m.beat, opts)] = { multiType: multiType, maxKeys: maxKeys, angle: angle };
    }
    return plan;
  }

  function readBpmPoints(s, opts) {
    var out = [];
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isBpmTrack(track) && m.attrs) {
        out.push({
          beat: readBeat(s, m.beat, opts),
          type: m.attrs.speedType,
          value: Number(m.attrs.value),
        });
      }
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function readTwirlSet(s, opts) {
    var set = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = findTrack(s, m.trackId);
      if (isTwirlTrack(track)) set[readBeat(s, m.beat, opts)] = true;
    }
    return set;
  }

  // 多押折返方向：0.3 默认按当前走向取内圈（cos>=0 ⇒ +1），可强制内/外。
  function resolveMultiTurn(curAbs, mode) {
    var inner = Math.cos((curAbs * Math.PI) / 180) >= 0 ? 1 : -1;
    if (mode === "outer") return -inner;
    return inner; // auto / inner
  }

  // 展开 floor：普通一个 beat 一块；多押点在该 beat 之前/之后再插块…
  //   multiType = single  → 不插（单轨）
  //   midspin → 在「原格」之前插 [X₁,999,X₂,999,…]（真·中旋，N 押 N 键，零净偏移）
  //   multi   → 在原格之后插 min(押数, 最大押数)−1 块（最多 maxKeys 键）
  // 状态机模型：处理规则统一——每个 beat 都按「当前多押状态」生成块。
  //   - 多押点会改写当前状态，并从该点起作用于它自己和它后面的所有 beat；
  //   - 后面若再遇到新多押点，则从新点起切换到新状态。
  //   - 初始状态 = 单轨。
  // 低速多押角度封顶（新版模型）：当前拍 BPM 严格小于基础 BPM 的 1/2 时，
  // 有效角度 = min(设定角度, 2.5°)。已选更小的角度（如 1°）保持不变。
  function effectiveMultiAngle(angle, bpmRatio) {
    return bpmRatio < 0.5 ? Math.min(angle, 2.5) : angle;
  }

  // 核心模型分叉（cfg.coreModel）：
  //   legacy：正常步进用 dir；多押固定 +(180−angle)、carry=+angle×blocks；
  //           旧“双押旋转”在插入块前翻转 dir 并按 floor 补 Twirl。
  //   modern：正常步进用 stepSign；多押按内圈 s 折返、carry=s×angle×blocks，
  //           后续走向跟随 stepSign；Twirl 由收尾统一计算。
  function buildAngleData(beats, counts, multiPlan, multAt, twirlSet, diffTable, cfg) {
    var angleData = [];
    var beatFloor = [];
    var dpTwirlFloors = [];
    // 与 angleData 逐格对齐的「有效拍差」：收尾自动 Twirl 用它区分 8 分（0.5）
    // 与附点四分（1.5）——两者都可能算出 ±90°，只有看时间才能决定短弧还是长弧。
    var floorDiffEff = [];
    var current = 0;
    var carry = 0;
    var dir = 1;
    var legacy = cfg.coreModel !== "modern";
    var stepSign = 1;

    var rapidCount = 0;
    var rapidBase = 1;
    var prevRapid = false;
    var prevN = 0;
    var rapidMode = 0;
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

      // 新版模型：多押折返/中旋都使用「有效角度」（低速自动封顶）；旧版用原始角度。
      var multiAngle = legacy
        ? state.angle
        : effectiveMultiAngle(state.angle, multAt(beats[j]));
      if (!legacy && isMultiBeat && state.multiType !== "single" && multiAngle !== state.angle) {
        panelLog(
          "  (低速多押角度) beat=" + beats[j] +
            " ratio=" + multAt(beats[j]) +
            " angle=" + state.angle + " -> " + multiAngle,
        );
      }

      var baseSign = legacy ? dir : stepSign;
      var effSign = baseSign;

      // 快速跑动：按细分形态决定是否换向（三角/之字），12/24 分同号。
      var isRapid =
        cfg.rapidRuns &&
        j > 0 &&
        diffEff > 1e-9 &&
        diffEff < 1 - 1e-9 &&
        !(isMultiBeat && state.multiType === "multi");
      if (isRapid) {
        var q = 1 / diffEff;
        var qr = Math.round(q);
        var isPow2Fine =
          Math.abs(q - qr) < 0.03 && qr >= 4 && (qr & (qr - 1)) === 0;
        var is8 = Math.abs(diffEff - 0.5) < 0.02;
        var is6 = Math.abs(diffEff - 2 / 3) < 0.02;
        if (is8 || is6) {
          var groupN = is8 ? 2 : 3;
          if (!prevRapid || rapidModePrev !== 1 || groupN !== prevN) {
            rapidCount = 0;
            rapidBase = baseSign;
          }
          var blk = Math.floor(rapidCount / groupN);
          effSign = blk % 2 === 0 ? rapidBase : -rapidBase;
          rapidCount++;
          prevN = groupN;
          rapidMode = 1;
        } else if (isPow2Fine) {
          if (!prevRapid || rapidModePrev !== 2) {
            rapidCount = 0;
            rapidBase = baseSign;
          }
          effSign = rapidCount % 2 === 0 ? rapidBase : -rapidBase;
          rapidCount++;
          rapidMode = 2;
        } else {
          // 12/24 分等：同号（保持 baseSign），不参与快速跑动换向。
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
        var presses = Math.min(pressCount, state.maxKeys);
        var pairs = presses - 1;
        var sumS = (multiAngle * pairs * (pairs + 1)) / 2;
        if (sumS > 0 && T - sumS >= DP_MIN_TRAVEL) {
          var partial = 0;
          for (var qp = 1; qp <= pairs; qp++) {
            partial += multiAngle * qp;
            var xCurrent = wrap360(current + (T - partial));
            if (qp === 1) beatFloor[j] = angleData.length;
            floorDiffEff.push(multiAngle / 180); // 折返格：短弧（=多押角度）
            angleData.push(dir * xCurrent);
            floorDiffEff.push(multiAngle / 180); // 999：0 拍，与下一格同瞬间
            angleData.push(MIDSPIN);
          }
          floorDiffEff.push((T - sumS) / 180); // 原格：剩余行进角
          angleData.push(dir * current);
          panelLog(
            "  (中旋插入) beat=" + beats[j] +
              " 押数=" + presses + " Σs=" + sumS + " T=" + T,
          );
          continue;
        }
        panelLog("  (中旋跳过：T=" + T + " 装不下 Σs=" + sumS + ") beat=" + beats[j]);
      }

      floorDiffEff.push(diffEff);
      angleData.push(dir * current);
      beatFloor[j] = angleData.length - 1;

      // 多押（multi）：在原格之后插 min(押数, 最大押数) − 1 块。
      var blocks = 0;
      if (isMultiBeat && state.multiType === "multi") {
        blocks = Math.min(pressCount, state.maxKeys) - 1;
        if (blocks < 1) blocks = 1;
      }
      if (blocks > 0) {
        if (legacy) {
          // 0.2 行为：固定 +(180−angle)；旧“双押旋转”在插入前翻转 dir。
          var ldp = !!cfg.legacyDoubleTwirl && pressCount === 2;
          if (ldp) dir = -dir;
          for (var ql = 0; ql < blocks; ql++) {
            current = wrap360(current + (180 - state.angle));
            floorDiffEff.push(state.angle / 180);
            angleData.push(dir * current);
          }
          if (ldp) dpTwirlFloors.push(beatFloor[j] + 1);
          carry = state.angle * blocks;
          panelLog(
            "  (多押-旧版) beat=" + beats[j] +
              " 押数=" + pressCount +
              " blocks=" + blocks +
              " angle=" + state.angle +
              " carry=" + carry +
              (ldp ? " 双押旋转->floor " + (beatFloor[j] + 1) : ""),
          );
        } else {
          // 0.3 行为：按当前走向取内圈 s，carry = s×angle×blocks，后续跟随 s。
          var curAbs = dir * current;
          var s = resolveMultiTurn(curAbs, cfg.multiTurn);
          for (var qm = 0; qm < blocks; qm++) {
            current = wrap360(current + dir * s * (180 - multiAngle));
            floorDiffEff.push(multiAngle / 180); // 折返格：短弧（=多押角度）
            angleData.push(dir * current);
          }
          carry = s * multiAngle * blocks;
          stepSign = s;
          panelLog(
            "  (多押-新版) beat=" + beats[j] +
              " 押数=" + pressCount +
              " blocks=" + blocks +
              " angle=" + multiAngle +
              " s=" + s +
              " carry=" + carry,
          );
        }
      }
    }
    return {
      angleData: angleData,
      beatFloor: beatFloor,
      dpTwirlFloors: dpTwirlFloors,
      floorDiffEff: floorDiffEff,
    };
  }

  // 发卡弯同号 + 闭环朝上：实验性启发式，开启后整体改写 angleData。
  function normalizeAngles(angleData) {
    var hairpinSign = 0;
    for (var kk = 1; kk < angleData.length; kk++) {
      if (angleData[kk] === MIDSPIN || angleData[kk - 1] === MIDSPIN) continue;
      var dk = angleData[kk] - angleData[kk - 1];
      var sdk = (((dk % 360) + 540) % 360) - 180;
      if (Math.abs(Math.abs(sdk) - 180) < 0.5) {
        sdk = dk >= 0 ? 180 : -180;
        if (hairpinSign === 0) hairpinSign = sdk > 0 ? 1 : -1;
        angleData[kk] = angleData[kk - 1] + hairpinSign * 180;
      } else {
        angleData[kk] = angleData[kk - 1] + sdk;
      }
    }

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
        if (Math.abs(dq) < 30) break;
        acc += dq;
        var am = Math.abs(acc % 360);
        if (Math.abs(acc) >= 300 && (am < 1 || Math.abs(am - 360) < 1)) {
          segEnd = q;
          break;
        }
      }
      if (segEnd > mirrorAt) {
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
    for (var rb = 1; rb < angleData.length; rb++) {
      if (mirrorDeltas[rb] === null) continue;
      angleData[rb] = angleData[rb - 1] + mirrorDeltas[rb];
    }
    return angleData;
  }

  // 自动 Twirl：按最终 angleData 计算——维护“上一个显著转角的符号”，符号变化时在该块放 Twirl。
  // 发卡弯（|Δ|≈180°）不参与，避免“该翻转却不翻转”。
  function computeAutoTwirl(angleData, threshold, hairpinExclude) {
    var floors = [];
    var lastSign = 1;
    for (var ti = 1; ti < angleData.length; ti++) {
      if (angleData[ti] === MIDSPIN || angleData[ti - 1] === MIDSPIN) continue;
      var td = angleData[ti] - angleData[ti - 1];
      var tdn = (((td % 360) + 540) % 360) - 180;
      var atd = Math.abs(tdn);
      if (atd >= threshold - 1e-6 && atd < hairpinExclude) {
        var ts = tdn > 0 ? 1 : -1;
        if (ts !== lastSign) {
          floors.push(ti);
          lastSign = ts;
        }
      }
    }
    return floors;
  }

  // 新版自动 Twirl（0.3.5 弧长模型）：按最终 angleData + 每格目标行进角决定短弧/长弧。
  //   公转方向（CCW/CW）决定同一转角走短弧还是长弧：
  //     短格（行进 < 1 拍，如 8 分）：让转角与公转方向同号（短弧）；
  //     长格（行进 > 1 拍，如附点四分 270°）：让两者反号（长弧）。
  //   当前公转方向不满足目标时，就在该格放 Twirl 并翻转方向，状态连续传递。
  //   发卡弯（|Δ|≈180°）不参与（Twirl 会让它反而不翻转）。
  function computeAutoTwirlArc(angleData, floorDiffEff) {
    var floors = [];
    var twSign = 1; // 当前公转方向：+1 = 逆时针（+ 转角走短弧）
    for (var ti = 1; ti < angleData.length; ti++) {
      if (angleData[ti] === MIDSPIN || angleData[ti - 1] === MIDSPIN) continue;
      var td = angleData[ti] - angleData[ti - 1];
      var atd = Math.abs(td);
      if (atd < 90 - 1e-6 || atd >= 179.5) continue;
      var de = floorDiffEff[ti] || 0;
      var ts = td > 0 ? 1 : -1;
      // 目标公转方向：短格同号、长格反号
      var want = de > 1 + 1e-9 ? -ts : ts;
      if (want !== twSign) {
        floors.push(ti);
        twSign = want;
      }
    }
    return floors;
  }

  // Pause 时长按拍计（引擎把 duration 看作等待拍数）。
  //   legacy（0.2）：普通相邻块自占 1 拍，填补 diffEff 需等待 diffEff − 1；
  //     倍率用终点 BPM；修复#2（默认关）在 dur > 2 时再减 1。
  //   modern（0.3.5）：真正的发卡弯（该格最终 |Δ|≈180°）游戏按 2 拍播放，
  //     自身多占 1 拍，长间隔需再减 1；倍率用起点 beat（SetSpeed 到达后才生效）。
  function buildActions(beats, beatFloor, multAt, diffTable, angleData, modern) {
    var actions = [];
    for (var j = 0; j < beats.length - 1; j++) {
      var diff = diffTable[j + 1];
      if (!modern) {
        var mult0 = multAt(beats[j + 1]);
        var diffEff0 = diff * mult0;
        if (diffEff0 > 2) {
          var dur0 = diffEff0 - 1;
          if (config.pauseFix1) {
            if (dur0 > 1 && dur0 < 2) dur0 = 2;
            else if (dur0 > 2 && dur0 < 3) dur0 = 2;
          }
          if (config.pauseFix2 && dur0 > 2) dur0 -= 1;
          actions.push({
            floor: beatFloor[j + 1],
            eventType: "Pause",
            duration: dur0,
            countdownTicks: 0,
            angleCorrectionDir: "Backward",
          });
        }
        continue;
      }

      // 新版：该段行进由「起点 beat」的 BPM 决定（与 buildAngleData 的 multAt 一致）。
      var mult = multAt(beats[j]);
      var diffEff = diff * mult;
      var floor = beatFloor[j + 1];
      // 180° 发卡格在游戏里占 2 拍（无论 +180 / -180）；直行格占 1 拍。
      var hairpinBeats = 1;
      if (floor > 0 && floor < angleData.length) {
        if (angleData[floor] !== MIDSPIN && angleData[floor - 1] !== MIDSPIN) {
          if (Math.abs(Math.abs(angleData[floor] - angleData[floor - 1]) - 180) < 0.5) {
            hairpinBeats = 2;
          }
        }
      }
      // 需要 Pause 只针对 diffEff > 2 的长间隔：一格最多画 2 拍（180° 发卡 / step=-180），
      // 超过 2 拍的部分才用 Pause 补。diffEff == 2 时这一格本身就是 2 拍（[0,180] 实测，
      // 有没有 Twirl 都是 2.0），再挂 Pause 会变成 3 拍 —— 之前 floor 675~692 的一拍
      // Pause 就是这条误判（0.5 拍 × 4 倍速恰好 = 2）造成的。
      var needPause = diffEff > 2 + 1e-9;
      if (!needPause) continue;
      var dur = diffEff - 1;
      if (config.pauseFix1) {
        if (dur > 1 && dur < 2) dur = 2;
        else if (dur > 2 && dur < 3) dur = 2;
      }
      // 发卡格自身占 2 拍，长间隔再减 1；直行格只占 1 拍，不减。
      if (dur > 2 && hairpinBeats === 2) dur -= 1;
      actions.push({
        floor: floor,
        eventType: "Pause",
        duration: dur,
        countdownTicks: 0,
        angleCorrectionDir: "Backward",
      });
    }
    return actions;
  }

  // 入参 resolved 由 buildLevel.resolveBpmPoints() 统一解析：每个点已带「累积后的绝对 BPM」
  // 与「是否绝对点」，确保 SetSpeed 事件和角度换算（bpmAt/multAt）用的是同一组数字，
  // 绝对 BPM 点不会出现「事件写成 80、几何仍按上一档 214」这种错位。
  function buildSetSpeed(beats, beatFloor, resolved, baseBpm, settings, modern) {
    var arr = [];
    var idxByBeat = {};
    for (var i = 0; i < beats.length; i++) idxByBeat[beats[i]] = i;
    // 两种模型都是「相对上一个点的 BPM」累积（与游戏编辑器一致）：
    //   倍频点：target = 当前 BPM × value；绝对 BPM 点：target = value。
    //   第一个点相对于初始 BPM（baseBpm / 首拍 BPM）。
    //   modern 额外把「首拍 BPM」写进 settings.bpm，因此第一个点写相邻比值（通常为 1）。
    var prevBpm = modern ? (settings.bpm || baseBpm) : baseBpm;
    for (var k = 0; k < resolved.length; k++) {
      var r = resolved[k];
      var target = r.bpm;
      var floor = beatFloor[idxByBeat[r.beat]] + config.speedPlaceOffset;
      if (modern) {
        if (floor <= 0) {
          settings.bpm = target;
          prevBpm = target;
          panelLog("  (初始BPM) beat=" + r.beat + " -> settings.bpm=" + target);
          continue;
        }
        arr.push({
          floor: floor,
          eventType: "SetSpeed",
          speedType: r.abs ? "Bpm" : "Multiplier",
          beatsPerMinute: target,
          // 游戏里 Multiplier 乘在【当前 BPM】上；这里写「目标 / 上一事件后的 BPM」，
          // 首拍点因已被 settings.bpm 吸收，比值会是 1。
          bpmMultiplier: r.abs ? 1 : target / prevBpm,
          angleOffset: 0,
        });
        prevBpm = target;
        continue;
      }
      // legacy（0.2）
      if (floor <= 0) {
        settings.bpm = target;
        panelLog("  (初始BPM) beat=" + r.beat + " -> settings.bpm=" + target);
        continue;
      }
      arr.push({
        floor: floor,
        eventType: "SetSpeed",
        speedType: r.abs ? "Bpm" : "Multiplier",
        beatsPerMinute: target,
        bpmMultiplier: r.abs ? 1 : r.value,
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
      // 与 bpmAt 一致：倍频乘在当前 BPM 上累积。
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
  function checkSmallAngles(beats, counts, beatFloor, multiPlan, multAt, diffTable, modern) {
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
      var multiAngle = modern
        ? effectiveMultiAngle(state.angle, multAt(beats[j]))
        : state.angle;
      if (state.multiType !== "single" && isMultiBeat && travel < multiAngle - 1e-9) {
        if (lastWarnBeat === null || beats[j] - lastWarnBeat > 1) {
          out.push(
            "夹角 beat " + beats[j] + "（floor " + beatFloor[j] + "）：travel " +
              round2(travel) + "° < 多押角度 " + multiAngle + "°，请检查。",
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

  function buildDecorations(s, beatFloor, beats, angleData, bpb, opts) {
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

    // 一个四分音符（1 拍）对应的横向间隔：自动模式下以铺开约 80 格为目标，
    // 但单拍间隔限制在 0.2–1 格，避免短工程被拉得过开。
    var spacingX =
      config.spacingX > 0
        ? config.spacingX
        : Math.max(0.2, Math.min(1.0, 80 / totalBeats));
    var gapY = config.laneGap;
    var laneSpan = (n - 1) * gapY;
    var lineTiles = Math.max(0.3, laneSpan + 0.4);

    function xOfBeat(b) {
      return (b - firstBeat) * spacingX;
    }

    for (var li = 0; li < n; li++) {
      var lane = lineTracks[li];
      var laneY = (li - (n - 1) / 2) * gapY;
      var color = String(lane.color || "#ffffff").replace("#", "");
      var firstDone = false;
      for (var mi = 0; mi < s.markers.length; mi++) {
        var m = s.markers[mi];
        if (m.trackId !== lane.id) continue;
        var lx = xOfBeat(readBeat(s, m.beat, opts));
        decos.push(makeDeco(baseFloor, "bdg_lane_dot.png", lx, laneY, 22, color));
        if (!firstDone) {
          firstDone = true;
          decos.push(makeDeco(baseFloor, "bdg_lane_planet.png", lx, laneY, 34, color));
        }
      }
    }

    // 小节线：从 firstBeat 所在小节起，纵向贯穿所有泳道，以 y=0 居中
    var lineScaleY = lineTiles * 100;
    var barStart = Math.floor(firstBeat / bpb) * bpb;
    var barEnd = firstBeat + totalBeats;
    for (var bb = barStart; bb <= barEnd + 0.001; bb += bpb) {
      var ln = makeDeco(baseFloor, "bdg_lane_line.png", xOfBeat(bb), 0, 40, "ffffff");
      ln.scale = [40, lineScaleY];
      ln.opacity = 26;
      decos.push(ln);
    }

    // 播放头：只在第一块放一个装饰，并用【一条】MoveDecorations 线性移动到终点
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
    var a = 1,
      b = 0;
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
    ihdr[0] = (w >>> 24) & 255;
    ihdr[1] = (w >>> 16) & 255;
    ihdr[2] = (w >>> 8) & 255;
    ihdr[3] = w & 255;
    ihdr[4] = (h >>> 24) & 255;
    ihdr[5] = (h >>> 16) & 255;
    ihdr[6] = (h >>> 8) & 255;
    ihdr[7] = h & 255;
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
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
    for (var p2 = 0; p2 < parts.length; p2++) {
      png.set(parts[p2], o);
      o += parts[p2].length;
    }
    return png;
  }
  function diamondPng(size) {
    var rgba = new Uint8Array(size * size * 4);
    var c = (size - 1) / 2;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var d = (Math.abs(x - c) + Math.abs(y - c)) / (size * 0.46);
        var i = (y * size + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = d <= 1 ? 235 : d <= 1.1 ? Math.round(((1.1 - d) / 0.1) * 235) : 0;
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
        var a = r <= 0.42 ? 1 : r >= 1 ? 0 : ((1 - r) / 0.58) * 0.85;
        var i = (y * size + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    return encodePng(size, size, rgba);
  }
  function linePng(size) {
    var rgba = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var i = (y * size + x) * 4;
        var edge = Math.abs(x - (size - 1) / 2) <= 2 ? 1 : 0;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
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

    var modernCore = config.coreModel === "modern";
    var legacyCore = !modernCore;
    // 新版模型对齐 v19 示例：关卡版本 / 缩放 / 默认背景；旧版保持 0.2 默认不变。
    if (modernCore) {
      settings.version = 19;
      settings.zoom = 200;
      settings.showDefaultBGTile = false;
      settings.defaultBGShapeType = "Disabled";
    }
    // 关卡音乐只填文件名（不带路径）：新版会在导出时把音频复制到关卡同目录。
    // 旧版保持 0.2 行为（直接用 audioName），保证逐字节一致。
    if (modernCore) {
      var audioAbs = api.system.audioPath ? api.system.audioPath() : null;
      var audioSrc = audioAbs || s.audioName || "";
      settings.songFilename = audioSrc ? String(audioSrc).split(/[\\/]/).pop() : "";
    } else {
      settings.songFilename = s.audioName || "";
    }
    settings.bpm = baseBpm;
    settings.offset = Math.round(s.offsetMs);

    // 旧版模型的“轨道生成”必须与 0.2 完全一致：吸附/快速跑动/发卡后处理
    // 都属于新版轨道启发式，即使配置里残留开启，也不参与旧版导出。
    var trackCfg = {
      coreModel: config.coreModel,
      legacyDoubleTwirl: config.legacyDoubleTwirl,
      multiTurn: config.multiTurn,
      rapidRuns: legacyCore ? false : config.rapidRuns,
      snapNearInt: legacyCore ? false : config.snapNearInt,
      snapTolerance: config.snapTolerance,
      normalizeAngles: legacyCore ? false : config.normalizeAngles,
    };

    var scan = scanBeats(s, trackCfg);
    var beats = scan.beats;
    var counts = scan.counts;
    var beatSet = {};
    for (var i = 0; i < beats.length; i++) beatSet[beats[i]] = true;

    var bpmPoints = readBpmPoints(s, trackCfg);
    for (var v = 0; v < bpmPoints.length; v++) {
      if (!(bpmPoints[v].beat in beatSet)) {
        return { error: "BPM 点 beat " + bpmPoints[v].beat + " 未落在 marker 上，拒绝导出。" };
      }
    }

    // 统一解析 BPM 点：从 baseBpm 起依次套用——
    //   「BPM值」= 绝对重置；「倍频」= 乘在当前 BPM 上（与游戏编辑器一致；
    //   连续两个 2 倍频 => ×4）。resolvedBpm 是唯一来源：角度换算与 SetSpeed 共用，
    //   绝对 BPM 点绝不会只改事件、不改几何。
    var resolvedBpm = [];
    (function () {
      var bpm = baseBpm;
      for (var q = 0; q < bpmPoints.length; q++) {
        var p = bpmPoints[q];
        var isAbs = p.type === "bpm";
        bpm = isAbs ? p.value : bpm * p.value;
        resolvedBpm.push({ beat: p.beat, bpm: bpm, abs: isAbs, value: p.value });
      }
    })();
    function bpmAt(beat) {
      var bpm = baseBpm;
      for (var q = 0; q < resolvedBpm.length; q++) {
        if (resolvedBpm[q].beat <= beat) bpm = resolvedBpm[q].bpm;
        else break;
      }
      return bpm;
    }
    // 相对 baseBpm 的倍率（角度 / Pause 换算用）
    function multAt(beat) {
      return bpmAt(beat) / baseBpm;
    }
    // 新版：开头（第一块砖）的 BPM 写入 settings.bpm，beat 0 的倍频点直接生效。
    if (modernCore) settings.bpm = bpmAt(beats.length ? beats[0] : 0);

    var twirlSet = readTwirlSet(s, trackCfg);
    for (var b in twirlSet) {
      if (!(b in beatSet)) {
        return { error: "旋转点 beat " + b + " 未落在 marker 上，拒绝导出。" };
      }
    }

    var multiPlan = readMultiPress(s, trackCfg);
    for (var bb in multiPlan) {
      if (!(bb in beatSet)) {
        return { error: "多押点 beat " + bb + " 未落在 marker 上，拒绝导出。" };
      }
    }

    var _bpmLog = baseBpm;
    for (var pp = 0; pp < bpmPoints.length; pp++) {
      _bpmLog = bpmPoints[pp].type === "bpm"
        ? bpmPoints[pp].value
        : _bpmLog * bpmPoints[pp].value;
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

    // 新版：用工程 tempo map（api.project.timeOfBeat）把相邻拍的真实时间差折回
    // 「基础拍」，角度 / Pause / 夹角检查都跟着音频走；不再假设等拍网格。
    // 旧版模型保持逐字节一致，仍用原始拍差。
    var beatMs = 60000 / baseBpm;
    var hasTempo =
      modernCore && baseBpm > 0 &&
      api.project && typeof api.project.timeOfBeat === "function";
    var timeBeats = hasTempo
      ? function (b) { return api.project.timeOfBeat(b) / beatMs; }
      : null;
    var diffTable = buildDiffTable(beats, trackCfg, timeBeats);
    // 自动 Twirl 与手动 Twirl 互斥：自动规则基于最终 angleData 计算，
    // 若同时计入手动 Twirl 会重复翻转，因此自动模式忽略手动 Twirl 轨道。
    var autoTwirl = config.twirlMode === "auto";
    var built = buildAngleData(
      beats,
      counts,
      multiPlan,
      multAt,
      autoTwirl ? null : twirlSet,
      diffTable,
      trackCfg,
    );
    if (trackCfg.normalizeAngles) normalizeAngles(built.angleData);
    if (autoTwirl) {
      built.autoTwirlFloors = modernCore
        ? computeAutoTwirlArc(built.angleData, built.floorDiffEff)
        : computeAutoTwirl(
            built.angleData,
            config.autoTwirlThreshold,
            config.hairpinExclude,
          );
    }

    var actions = buildActions(beats, built.beatFloor, multAt, diffTable, built.angleData, modernCore);
    actions = actions.concat(
      buildSetSpeed(beats, built.beatFloor, resolvedBpm, baseBpm, settings, modernCore),
    );
    if (autoTwirl) {
      for (var at = 0; at < built.autoTwirlFloors.length; at++) {
        actions.push({ floor: built.autoTwirlFloors[at], eventType: "Twirl" });
        panelLog("Twirl(自动): floor " + built.autoTwirlFloors[at]);
      }
    } else if (config.twirlMode === "manual") {
      actions = actions.concat(buildTwirl(beats, built.beatFloor, twirlSet));
    }
    if (legacyCore && config.legacyDoubleTwirl) {
      for (var dp = 0; dp < built.dpTwirlFloors.length; dp++) {
        actions.push({ floor: built.dpTwirlFloors[dp], eventType: "Twirl" });
        panelLog("Twirl(旧版双押): floor " + built.dpTwirlFloors[dp]);
      }
    }
    // 装饰泳道（含小节线 / 播放头动作）；小节拍数由 barBeats 控制
    var decoPack = buildDecorations(
      s,
      built.beatFloor,
      beats,
      built.angleData,
      config.barBeats,
      trackCfg,
    );
    actions = actions.concat(decoPack.actions);
    actions.sort(function (a, b) {
      if (a.floor !== b.floor) return a.floor - b.floor;
      if (legacyCore) {
        // 精确复刻 0.2 的排序（注意 SetSpeed 的 0 被 `|| 3` 视为假值，
        // 实际顺序为 Twirl → Pause → SetSpeed），保证旧版导出逐字节一致。
        var lo = { SetSpeed: 0, Twirl: 1, Pause: 2 };
        return (lo[a.eventType] || 3) - (lo[b.eventType] || 3);
      }
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
    if (config.showChecks) {
      warnings = warnings.concat(
        checkBpmRange(baseBpm, bpmPoints, built.beatFloor, idxByBeat),
      );
      warnings = warnings.concat(
        checkSmallAngles(beats, counts, built.beatFloor, multiPlan, multAt, diffTable, modernCore),
      );
    }

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
        if (!savedPath) return; // 用户取消保存
        if (!ok) {
          api.log("adofai export:", "write failed");
          api.ui.notify({
            message: "关卡文件写入失败。",
            type: "error",
            durationMs: 8000,
          });
          return;
        }
        api.log("adofai export:", "saved");
        var savedName = String(savedPath).split(/[\\/]/).pop();
        api.ui.notify({
          message: "已导出：" + savedName,
          type: "success",
          durationMs: 4000,
        });
        // 装饰素材 + 音乐都写到关卡同目录（decorationImage / songFilename 按关卡目录解析）
        var dir = String(savedPath).replace(/[\\/][^\\/]*$/, "");
        var jobs = [];
        if (config.fakeLanes) {
          jobs.push(
            Promise.all([
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
            }),
          );
        }
        // 复制关卡音乐（仅新版，与 songFilename 取音频路径保持一致）；
        // 目标已存在则跳过，不做无谓覆盖。
        var audioAbs = null;
        if (config.coreModel === "modern" && api.system.audioPath) {
          audioAbs = api.system.audioPath();
        }
        if (audioAbs) {
          var audioName = String(audioAbs).split(/[\\/]/).pop();
          var audioDest = dir + "/" + audioName;
          jobs.push(
            api.system.readBytes(audioDest).then(function (existing) {
              if (existing) {
                api.log("adofai export: audio exists, skip");
                return;
              }
              return api.system.readBytes(audioAbs).then(function (bytes) {
                if (!bytes) return;
                return api.system.writeBytes(audioDest, bytes).then(function () {
                  api.log("adofai export: audio copied");
                });
              });
            }),
          );
        }
        return Promise.all(jobs);
      })
      .catch(function (err) {
        var msg2 = err && err.message ? err.message : String(err);
        api.log("adofai export: failed", msg2);
        api.ui.notify({ message: "导出失败：" + msg2, type: "error" });
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

  // 多押轨道：踩点 attrs（类型/最大押数/角度）驱动该位置及之后的多押生成。
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
          { value: 2.5, label: "2.5°（低速多押建议）" },
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

  var PANEL_STYLE_ID = "adofai-panel-style";
  function injectPanelStyles() {
    if (document.getElementById(PANEL_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = PANEL_STYLE_ID;
    style.textContent = [
      ".adofai-panel{--adofai-line:rgba(127,127,127,.28);",
      "--adofai-line-strong:rgba(127,127,127,.45);--adofai-fill:rgba(127,127,127,.06);",
      "--adofai-fill-hover:rgba(127,127,127,.14);--adofai-fill-on:rgba(127,127,127,.22);",
      "--adofai-radius:8px;display:flex;flex-direction:column;height:100%;min-height:0;",
      "container-type:inline-size;font-size:13px;line-height:1.5;color:inherit;",
      "color-scheme:light dark}",
      ".adofai-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 12px 16px;",
      "scrollbar-width:thin;scrollbar-color:var(--adofai-line-strong) transparent}",
      ".adofai-section{margin:0 0 12px;padding:10px 12px 6px;",
      "border:1px solid var(--adofai-line);border-radius:10px;background:var(--adofai-fill)}",
      ".adofai-section:last-child{margin-bottom:0}",
      ".adofai-section-title{display:flex;align-items:center;gap:8px;margin:0 0 4px;",
      "font-weight:600;font-size:12px;letter-spacing:.03em;opacity:.95}",
      ".adofai-section-title::before{content:'';width:3px;height:10px;border-radius:2px;",
      "background:currentColor;opacity:.45}",
      ".adofai-badge{font-size:10px;font-weight:500;padding:1px 7px;border-radius:999px;",
      "border:1px solid var(--adofai-line-strong);opacity:.7;letter-spacing:0}",
      ".adofai-row{display:flex;align-items:center;gap:12px;min-height:34px;padding:1px 0}",
      ".adofai-labelwrap{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0}",
      ".adofai-label{min-width:0;cursor:default;line-height:1.35}",
      ".adofai-control{flex:0 0 auto;display:flex;align-items:center;gap:6px}",
      ".adofai-row.wide .adofai-control{flex:1 1 auto;min-width:0}",
      ".adofai-row.wide .adofai-seg{width:100%}",
      ".adofai-select,.adofai-input{height:27px;padding:2px 7px;",
      "border-radius:var(--adofai-radius);border:1px solid var(--adofai-line-strong);",
      "background:var(--adofai-fill);color:inherit;font:inherit;font-size:12px;outline:none}",
      ".adofai-input{width:72px;text-align:right;font-variant-numeric:tabular-nums}",
      ".adofai-select{min-width:0;max-width:180px}",
      ".adofai-select:focus-visible,.adofai-input:focus-visible,.adofai-btn:focus-visible,",
      ".adofai-seg-btn:focus-visible,.adofai-help:focus-visible{outline:2px solid currentColor;",
      "outline-offset:2px}",
      ".adofai-select:hover,.adofai-input:hover{background:var(--adofai-fill-hover);",
      "border-color:currentColor}",
      ".adofai-input:disabled,.adofai-select:disabled,.adofai-check:disabled{opacity:.4;",
      "cursor:not-allowed}",
      ".adofai-check{width:16px;height:16px;margin:0;accent-color:currentColor;cursor:pointer}",
      ".adofai-unit{font-size:11px;opacity:.55}",
      ".adofai-btn{height:28px;padding:0 12px;border-radius:var(--adofai-radius);",
      "border:1px solid var(--adofai-line-strong);background:var(--adofai-fill);",
      "color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;",
      "transition:background-color .12s ease,border-color .12s ease}",
      ".adofai-btn:hover{background:var(--adofai-fill-hover);border-color:currentColor}",
      ".adofai-btn:active{transform:translateY(1px)}",
      ".adofai-btn.primary{background:var(--adofai-fill-on);border-color:currentColor;",
      "font-weight:600;padding:0 16px}",
      ".adofai-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}",
      ".adofai-seg{display:inline-flex;border:1px solid var(--adofai-line-strong);",
      "border-radius:var(--adofai-radius);overflow:hidden;background:var(--adofai-fill)}",
      ".adofai-seg-btn{border:0;background:transparent;color:inherit;font:inherit;",
      "font-size:12px;padding:0 12px;height:28px;cursor:pointer;flex:1 1 0;",
      "transition:background-color .12s ease}",
      ".adofai-seg-btn + .adofai-seg-btn{border-left:1px solid var(--adofai-line)}",
      ".adofai-seg-btn:hover{background:var(--adofai-fill-hover)}",
      ".adofai-seg-btn.on{background:var(--adofai-fill-on);font-weight:600}",
      ".adofai-help{width:17px;height:17px;padding:0;border-radius:50%;flex:0 0 auto;",
      "border:1px solid var(--adofai-line-strong);background:transparent;color:inherit;",
      "font-size:11px;line-height:1;cursor:help;opacity:.5;transition:opacity .12s ease}",
      ".adofai-help:hover,.adofai-help:focus-visible{opacity:1}",
      ".adofai-hint,.adofai-note{font-size:12px;opacity:.62;line-height:1.55;",
      "margin:2px 0 8px}",
      ".adofai-note{padding:7px 9px;border-radius:var(--adofai-radius);",
      "border:1px solid var(--adofai-line);background:var(--adofai-fill-hover);opacity:.85}",
      ".adofai-footer{flex:0 0 auto;display:flex;gap:8px;justify-content:flex-end;",
      "align-items:center;padding:10px 12px;border-top:1px solid var(--adofai-line);",
      "background:var(--adofai-fill)}",
      ".adofai-footnote{flex:1 1 auto;font-size:11px;opacity:.5;letter-spacing:.02em}",
      "@container (max-width:360px){.adofai-scroll{padding:10px 8px 14px}",
      ".adofai-section{padding:9px 10px 5px}.adofai-input{width:64px}}",
      "@media (prefers-reduced-motion:reduce){.adofai-btn,.adofai-seg-btn,",
      ".adofai-help{transition:none}.adofai-btn:active{transform:none}}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  api.ui.registerPanel({
    id: "adofai-config",
    title: { zh: "ADOFAI 导出设置", en: "ADOFAI Export Options" },
    defaultWidth: 420,
    defaultHeight: 640,
    minWidth: 340,
    minHeight: 420,
    mount: function mount(host) {
      function clear() {
        host.textContent = "";
      }
      function el(tag) {
        return document.createElement(tag);
      }
      var controlSeq = 0;
      function ensureId(control) {
        if (!control.id) control.id = "adofai-ctl-" + (++controlSeq);
        return control.id;
      }
      function helpButton(text) {
        var b = el("button");
        b.type = "button";
        b.className = "adofai-help";
        b.textContent = "?";
        b.title = text;
        b.setAttribute("aria-label", text);
        b.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        });
        return b;
      }
      function row(labelText, control, helpText, unit, wide) {
        var r = el("div");
        r.className = "adofai-row" + (wide ? " wide" : "");
        var wrap = el("div");
        wrap.className = "adofai-labelwrap";
        var label = el("label");
        label.className = "adofai-label";
        label.textContent = labelText;
        if (control && control.id) label.htmlFor = control.id;
        wrap.appendChild(label);
        if (helpText) wrap.appendChild(helpButton(helpText));
        var cw = el("div");
        cw.className = "adofai-control";
        cw.appendChild(control);
        if (unit) {
          var u = el("span");
          u.className = "adofai-unit";
          u.textContent = unit;
          cw.appendChild(u);
        }
        r.appendChild(wrap);
        r.appendChild(cw);
        return r;
      }
      function section(text, badgeText) {
        var d = el("div");
        d.className = "adofai-section";
        var t = el("div");
        t.className = "adofai-section-title";
        t.textContent = text;
        if (badgeText) {
          var b = el("span");
          b.className = "adofai-badge";
          b.textContent = badgeText;
          t.appendChild(b);
        }
        d.appendChild(t);
        return d;
      }
      function hint(text, cls) {
        var d = el("div");
        d.className = cls || "adofai-hint";
        d.textContent = text;
        return d;
      }
      function checkbox(initial, onChange) {
        var cb = el("input");
        cb.type = "checkbox";
        cb.className = "adofai-check";
        ensureId(cb);
        cb.checked = !!initial;
        cb.addEventListener("change", function () {
          onChange(cb.checked);
          saveConfig();
        });
        return cb;
      }
      function numberInput(value, step, min, max, onChange) {
        var inp = el("input");
        inp.type = "number";
        inp.className = "adofai-input";
        inp.inputMode = "decimal";
        ensureId(inp);
        inp.step = String(step);
        if (min != null) inp.min = String(min);
        if (max != null) inp.max = String(max);
        inp.value = String(value);
        inp.addEventListener("change", function () {
          var v = parseFloat(inp.value);
          if (isNaN(v)) v = value;
          if (min != null && v < min) v = min;
          if (max != null && v > max) v = max;
          inp.value = String(v);
          onChange(v);
          saveConfig();
        });
        return inp;
      }
      function selectInput(options, value, onChange) {
        var sel = el("select");
        sel.className = "adofai-select";
        ensureId(sel);
        for (var i = 0; i < options.length; i++) {
          var o = el("option");
          o.value = options[i].value;
          o.textContent = options[i].label;
          if (options[i].value === value) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", function () {
          onChange(sel.value);
          saveConfig();
        });
        return sel;
      }
      function button(text, onClick, primary) {
        var b = el("button");
        b.type = "button";
        b.className = "adofai-btn" + (primary ? " primary" : "");
        b.textContent = text;
        b.addEventListener("click", onClick);
        return b;
      }
      function segmented(options, current, onPick) {
        var g = el("div");
        g.className = "adofai-seg";
        var btns = [];
        for (var i = 0; i < options.length; i++) {
          (function (opt) {
            var b = el("button");
            b.type = "button";
            b.className = "adofai-seg-btn";
            b.textContent = opt.label;
            b.dataset.value = opt.value;
            b.addEventListener("click", function () {
              onPick(opt.value);
            });
            g.appendChild(b);
            btns.push(b);
          })(options[i]);
        }
        g._sync = function (v) {
          for (var j = 0; j < btns.length; j++) {
            var on = btns[j].dataset.value === v;
            btns[j].classList.toggle("on", on);
            btns[j].setAttribute("aria-pressed", on ? "true" : "false");
          }
        };
        g._sync(current);
        return g;
      }
      function setDisabled(control, disabled) {
        if (!control) return;
        control.disabled = !!disabled;
      }

      var modelSeg = null;
      var presetBtn = null;
      var modeHint = null;
      var modernNote = null;
      var speedOff = null;
      var pause1 = null;
      var pause2 = null;
      var twirlSel = null;
      var legacyTw = null;
      var snapCb = null;
      var tolInput = null;
      var rapidCb = null;
      var normCb = null;
      var turnSel = null;
      var laneCb = null;
      var laneGap = null;
      var spacingX = null;
      var barBeats = null;
      var checksCb = null;

      function applyPreset(which) {
        config.coreModel = which === "modern" ? "modern" : "legacy";
        config.pauseFix2 = false;
        config.snapNearInt = false;
        config.rapidRuns = false;
        config.normalizeAngles = false;
        config.fakeLanes = false;
        // 旧版用旧双押旋转；新版轨道配合自动 Twirl 才正常。
        config.twirlMode = which === "modern" ? "auto" : "manual";
        config.multiTurn = "auto";
        if (which === "modern") config.legacyDoubleTwirl = false;
        saveConfig();
        syncAll();
      }
      function setModel(which) {
        config.coreModel = which === "modern" ? "modern" : "legacy";
        if (config.coreModel === "modern") {
          config.legacyDoubleTwirl = false;
          // 新版轨道只有配合自动 Twirl 才正常；仅覆盖“手动”默认，用户可再改。
          if (config.twirlMode === "manual") config.twirlMode = "auto";
        } else if (config.twirlMode === "auto") {
          config.twirlMode = "manual";
        }
        saveConfig();
        syncAll();
      }
      function resetDefaults() {
        var d = defaultConfig();
        for (var k in d) config[k] = d[k];
        saveConfig();
        syncAll();
        api.ui.notify({ message: "已恢复默认设置", type: "success", durationMs: 2500 });
      }

      function applyDerived() {
        var legacy = config.coreModel !== "modern";
        if (modelSeg) modelSeg._sync(config.coreModel);
        if (presetBtn) {
          presetBtn.textContent = legacy ? "套用旧版 0.2 预设" : "套用新版 0.3 预设";
        }
        if (modeHint) {
          modeHint.textContent = legacy
            ? "完全按 0.2 生成轨道：吸附 / 快速跑动 / 发卡后处理会被强制忽略，Twirl 使用手动轨道或旧版双押旋转。"
            : "轨道按 0.3 生成：默认开启自动 Twirl；下方“步进与角度”的选项才会生效。";
        }
        if (modernNote) modernNote.style.display = legacy ? "" : "none";
        setDisabled(legacyTw, !legacy);
        setDisabled(snapCb, legacy);
        setDisabled(tolInput, legacy);
        setDisabled(rapidCb, legacy);
        setDisabled(normCb, legacy);
        setDisabled(turnSel, legacy);
      }

      function syncAll() {
        if (modelSeg) modelSeg._sync(config.coreModel);
        if (speedOff) speedOff.value = String(config.speedPlaceOffset);
        if (pause1) pause1.checked = !!config.pauseFix1;
        if (pause2) pause2.checked = !!config.pauseFix2;
        if (twirlSel) twirlSel.value = config.twirlMode;
        if (legacyTw) legacyTw.checked = !!config.legacyDoubleTwirl;
        if (snapCb) snapCb.checked = !!config.snapNearInt;
        if (tolInput) tolInput.value = String(config.snapTolerance);
        if (rapidCb) rapidCb.checked = !!config.rapidRuns;
        if (normCb) normCb.checked = !!config.normalizeAngles;
        if (turnSel) turnSel.value = config.multiTurn;
        if (laneCb) laneCb.checked = !!config.fakeLanes;
        if (laneGap) laneGap.value = String(config.laneGap);
        if (spacingX) spacingX.value = String(config.spacingX);
        if (barBeats) barBeats.value = String(config.barBeats);
        if (checksCb) checksCb.checked = !!config.showChecks;
        applyDerived();
      }

      function render() {
        clear();
        injectPanelStyles();
        var panel = el("div");
        panel.className = "adofai-panel";
        var scroll = el("div");
        scroll.className = "adofai-scroll";
        panel.appendChild(scroll);
        host.appendChild(panel);

        scroll.appendChild(section("导出模型"));
        modelSeg = segmented(
          [
            { value: "legacy", label: "旧版 0.2" },
            { value: "modern", label: "新版 0.3" },
          ],
          config.coreModel,
          setModel,
        );
        scroll.appendChild(
          row(
            "核心模型",
            modelSeg,
            "旧版=完全复刻 0.2（吸附/快速跑动/发卡后处理强制忽略）；新版=0.3 轨道生成，默认配合自动 Twirl。",
            null,
            true,
          ),
        );

        var presetRow = el("div");
        presetRow.className = "adofai-row";
        var presetWrap = el("div");
        presetWrap.className = "adofai-labelwrap";
        var presetLabel = el("label");
        presetLabel.className = "adofai-label";
        presetLabel.textContent = "模型预设";
        presetWrap.appendChild(presetLabel);
        presetWrap.appendChild(
          helpButton(
            "一键套用该模型的默认组合（会关闭吸附/快速跑动/发卡后处理/装饰泳道，不影响你的容差、间距等个性值）。",
          ),
        );
        var presetCtl = el("div");
        presetCtl.className = "adofai-control";
        presetBtn = button("套用旧版 0.2 预设", function () {
          applyPreset(config.coreModel === "modern" ? "modern" : "legacy");
        });
        presetCtl.appendChild(presetBtn);
        presetRow.appendChild(presetWrap);
        presetRow.appendChild(presetCtl);
        scroll.appendChild(presetRow);

        modeHint = hint("");
        scroll.appendChild(modeHint);

        scroll.appendChild(section("变速 / 暂停"));
        speedOff = numberInput(config.speedPlaceOffset, 1, null, null, function (v) {
          config.speedPlaceOffset = v;
        });
        scroll.appendChild(
          row(
            "变速放置位置偏移",
            speedOff,
            "生成的 SetSpeed 事件 floor += 偏移：正数往后挪格，0 不改位置。",
            "格",
          ),
        );
        pause1 = checkbox(config.pauseFix1, function (v) {
          config.pauseFix1 = v;
        });
        scroll.appendChild(
          row(
            "暂停数值修复 #1",
            pause1,
            "把 Pause 的 duration 从 (1,2) 向上取整为 2，(2,3) 向下取整为 2。",
          ),
        );
        pause2 = checkbox(config.pauseFix2, function (v) {
          config.pauseFix2 = v;
        });
        scroll.appendChild(
          row(
            "暂停数值修复 #2",
            pause2,
            "在修复 #1 之后，duration > 2 时再减 1 拍（部分大间隔谱面实测会多停 1 拍）。",
          ),
        );

        scroll.appendChild(section("Twirl"));
        twirlSel = selectInput(
          [
            { value: "manual", label: "手动轨道" },
            { value: "auto", label: "自动（按最终角度）" },
            { value: "off", label: "关闭" },
          ],
          config.twirlMode,
          function (v) {
            config.twirlMode = v;
          },
        );
        scroll.appendChild(
          row(
            "Twirl 来源",
            twirlSel,
            "手动：使用旋转轨道；自动：按最终 angleData 生成并忽略手动轨道；关闭：不生成任何 Twirl。",
          ),
        );
        legacyTw = checkbox(config.legacyDoubleTwirl, function (v) {
          config.legacyDoubleTwirl = v;
        });
        scroll.appendChild(
          row(
            "旧版双押旋转",
            legacyTw,
            "仅旧版模型生效：多押且押数=2 时，在插入格生成 Twirl 并翻转 dir（等价 0.2 的 doublePressTwirl）。",
          ),
        );

        scroll.appendChild(section("步进与角度", "仅新版模型"));
        modernNote = hint("旧版模型会强制忽略本节选项（即使已勾选）。", "adofai-note");
        scroll.appendChild(modernNote);
        snapCb = checkbox(config.snapNearInt, function (v) {
          config.snapNearInt = v;
        });
        scroll.appendChild(
          row(
            "近整拍吸附",
            snapCb,
            "拍差距离整数 ≤ 容差时按整拍计算；角度、Pause、导出检查共用同一份吸附结果。",
          ),
        );
        tolInput = numberInput(config.snapTolerance, 0.01, 0, null, function (v) {
          config.snapTolerance = v;
        });
        scroll.appendChild(
          row("吸附容差", tolInput, "拍差与整数拍的允许偏差，默认 0.05 拍。", "拍"),
        );
        rapidCb = checkbox(config.rapidRuns, function (v) {
          config.rapidRuns = v;
        });
        scroll.appendChild(
          row(
            "快速跑动形态",
            rapidCb,
            "连续细分拍按 8 分三角、6 分三角、16/32 分之字、12/24 分同号处理。",
          ),
        );
        normCb = checkbox(config.normalizeAngles, function (v) {
          config.normalizeAngles = v;
        });
        scroll.appendChild(
          row(
            "发卡弯同号 / 闭环朝上",
            normCb,
            "实验性后处理，会整体改写 angleData：发卡弯强制同号，闭合且整体朝下的段落镜像朝上。",
          ),
        );
        turnSel = selectInput(
          [
            { value: "auto", label: "自动（内圈）" },
            { value: "inner", label: "强制内圈" },
            { value: "outer", label: "强制外圈" },
          ],
          config.multiTurn,
          function (v) {
            config.multiTurn = v;
          },
        );
        scroll.appendChild(
          row("多押折返方向", turnSel, "多押插入块的折返方向；自动与 0.3 默认一致。"),
        );

        scroll.appendChild(section("装饰泳道"));
        laneCb = checkbox(config.fakeLanes, function (v) {
          config.fakeLanes = v;
        });
        scroll.appendChild(
          row(
            "生成装饰泳道",
            laneCb,
            "按轨道颜色生成菱形/行星装饰、小节线与红色播放头，并在关卡同目录写入 bdg_lane_*.png。",
          ),
        );
        laneGap = numberInput(config.laneGap, 0.1, 0.2, null, function (v) {
          config.laneGap = v > 0 ? v : 0.5;
        });
        scroll.appendChild(row("泳道间距", laneGap, "装饰泳道之间的间距。", "格"));
        spacingX = numberInput(config.spacingX, 0.05, 0, null, function (v) {
          config.spacingX = v >= 0 ? v : 0;
        });
        scroll.appendChild(
          row("四分音符间隔", spacingX, "装饰物沿轨道的间隔；0 表示自动。", "格"),
        );
        barBeats = numberInput(config.barBeats, 1, 1, null, function (v) {
          config.barBeats = v >= 1 ? Math.floor(v) : 4;
        });
        scroll.appendChild(
          row("小节拍数", barBeats, "小节线与小节编号按此拍数对齐。", "拍"),
        );

        scroll.appendChild(section("导出检查"));
        checksCb = checkbox(config.showChecks, function (v) {
          config.showChecks = v;
        });
        scroll.appendChild(
          row(
            "导出前检查",
            checksCb,
            "命中变速区间/多押夹角时弹窗提醒，仅提醒、不阻拦导出。",
          ),
        );

        // 把每个分节标题之后的行收进同一个卡片，形成分组。
        var blocks = Array.prototype.slice.call(scroll.children);
        var group = null;
        for (var bi = 0; bi < blocks.length; bi++) {
          var node = blocks[bi];
          if ((node.className || "").split(/\s+/).indexOf("adofai-section") !== -1) {
            group = node;
          } else if (group) {
            group.appendChild(node);
          }
        }

        var footer = el("div");
        footer.className = "adofai-footer";
        var footNote = el("span");
        footNote.className = "adofai-footnote";
        footNote.textContent = "设置自动保存";
        footer.appendChild(footNote);
        footer.appendChild(button("恢复默认", resetDefaults));
        footer.appendChild(button("导出 .adofai", doExport, true));
        panel.appendChild(footer);

        applyDerived();
      }

      render();
      return function unmount() {
        clear();
      };
    },
  });

  // ---------------- 面板：多轨预览 ----------------
  // 每条轨道一条泳道；踩点画菱形；竖线为小节线；红线为播放头；随播放实时滚动。
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
      bar.style.cssText =
        "display:flex;align-items:center;gap:10px;font-size:12px;opacity:.85";
      var followLabel = document.createElement("label");
      followLabel.style.cssText =
        "display:flex;align-items:center;gap:4px;cursor:pointer";
      var followBox = document.createElement("input");
      followBox.type = "checkbox";
      followBox.checked = true;
      followLabel.appendChild(followBox);
      followLabel.appendChild(document.createTextNode("跟随播放"));
      var barInput = document.createElement("input");
      barInput.type = "number";
      barInput.min = "1";
      barInput.step = "1";
      barInput.value = String(config.barBeats);
      barInput.style.width = "52px";
      barInput.addEventListener("change", function () {
        var v = parseInt(barInput.value, 10);
        config.barBeats = isNaN(v) || v < 1 ? 4 : v;
        barInput.value = String(config.barBeats);
        saveConfig();
      });
      var barLabel = document.createElement("label");
      barLabel.style.cssText = "display:flex;align-items:center;gap:4px";
      barLabel.appendChild(document.createTextNode("每小节拍数"));
      barLabel.appendChild(barInput);
      bar.appendChild(followLabel);
      bar.appendChild(barLabel);

      function mkBtn(txt) {
        var bt = document.createElement("button");
        bt.type = "button";
        bt.textContent = txt;
        bt.style.cssText =
          "min-width:22px;height:20px;border-radius:4px;" +
          "border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);" +
          "color:inherit;cursor:pointer;font-size:12px;line-height:1";
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
      var scrollPx = 0;
      var inited = false;
      var cache = null;
      var cacheAt = 0;
      var cvW = 0;
      var cvH = 0;
      function fit() {
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, cv.clientWidth);
        var h = cv.clientHeight > 40 ? cv.clientHeight : 240;
        var ctx = cv.getContext("2d");
        if (w !== cvW || h !== cvH) {
          cvW = w;
          cvH = h;
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return { ctx: ctx, w: w, h: h };
      }

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
        var ctx = f.ctx;
        var W = f.w;
        var H = f.h;

        if (!cache || performance.now() - cacheAt > 500) buildCache();
        var tracks = cache.tracks;
        var laneH = tracks.length
          ? Math.max(18, Math.min(44, (H - 26) / tracks.length))
          : 24;
        var top = 18;

        var targetScroll = (posMs / 1000) * pxPerSec - W * 0.28;
        if (!inited) {
          scrollPx = targetScroll;
          inited = true;
        } else if (followBox.checked) {
          scrollPx += (targetScroll - scrollPx) * 0.22;
        }

        var x0 = scrollPx;
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

        ctx.font = "10px sans-serif";
        for (var bi = 0; bi < cache.bars.length; bi++) {
          var bx = timeToX(cache.bars[bi].ms);
          if (bx < -2 || bx > W + 2) continue;
          ctx.fillStyle = "rgba(255,255,255,0.30)";
          ctx.fillRect(Math.round(bx), top, 1, tracks.length * laneH);
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillText(
            String(cache.bars[bi].beat / cache.bpb + 1),
            Math.round(bx) + 3,
            11,
          );
        }

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

        ctx.fillStyle = "#ff3b5c";
        ctx.fillRect(Math.round(timeToX(posMs)), 0, 2, H);

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
