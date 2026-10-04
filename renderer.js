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


  // 中旋写法 [X₁,999,X₂,999,…,原格] 的参数（见 core/dp_midspin.py）：
  //   MIDSPIN    999 → 0 拍、出角=入角，与下一格同一瞬间按下
  //   DP_MIN_TRAVEL 原格 travel 被吃掉 Σsᵢ 后不能低于此值，否则成回头方块
  var MIDSPIN = 999;
  var DP_MIN_TRAVEL = 15;

  // 双押旋转（测试功能）定义：multiType==="multi" 且押数=2 时，在插入块所在格放一个
  // Twirl，并从该格起翻转 angleData 的角度符号（dir 镜像）。
  //   floorOffset：Twirl 落在「该 beat 原格」之后的第几个插入格（1 = 紧邻的插入块）。
  //   flipDir    ：从该格起是否翻转 dir（true = 角度取负，parity 翻转）。
  // 改这里即可调整测试口径。
  var DOUBLE_PRESS_TWIRL = { floorOffset: 1, flipDir: true };

  var bpmKey = api.id + ":bpm";
  var multiKey = api.id + ":multi";
  var twirlKey = api.id + ":twirl";

  // 面板设置：变速放置位置偏移（floor 相加，正数往后挪格）、暂停数值修复#1。
  var CONFIG_KEY = api.id + ":config";
  var config = { speedPlaceOffset: 1, pauseFix1: true, doublePressTwirl: false };
  try {
    var savedConfig = localStorage.getItem(CONFIG_KEY);
    if (savedConfig) {
      var parsedConfig = JSON.parse(savedConfig);
      if (parsedConfig && typeof parsedConfig === "object") {
        if (typeof parsedConfig.speedPlaceOffset === "number")
          config.speedPlaceOffset = parsedConfig.speedPlaceOffset;
        if (typeof parsedConfig.pauseFix1 === "boolean")
          config.pauseFix1 = parsedConfig.pauseFix1;
        if (typeof parsedConfig.doublePressTwirl === "boolean")
          config.doublePressTwirl = parsedConfig.doublePressTwirl;
      }
    }
  } catch (e) {
    api.log("adofai: load config failed:", e);
  }
  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      api.log("adofai: save config failed:", e);
    }
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
  function buildAngleData(beats, counts, multiPlan, multAt, twirlSet) {
    var angleData = [];
    var beatFloor = [];
    var dpTwirlFloors = []; // 双押旋转（测试）：额外生成的 Twirl 事件 floor
    var current = 0;
    var carry = 0;
    var dir = 1;
    var state = { multiType: "single", maxKeys: 3, angle: 15 }; // 初始：单轨
    for (var j = 0; j < beats.length; j++) {
      var diff = j === 0 ? 0 : beats[j] - beats[j - 1];
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

      current = wrap360(current + dir * step + carry);
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

      // 仅当该 beat 本身是「多押」（同 beat ≥2 个音砖）时才处理；
      // 普通单押 beat 一律不处理（即使当前状态是多押）。
      var pressCount = counts[beats[j]] || 1;
      var isMultiBeat = pressCount >= 2;

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
        // 双押旋转（测试）：真·双押（multi + 押数=2）时，按 DOUBLE_PRESS_TWIRL 在
        // 插入块所在格放 Twirl，并从该格起翻转 dir 镜像。
        var dpTwirl = config.doublePressTwirl && pressCount === 2;
        if (dpTwirl && DOUBLE_PRESS_TWIRL.flipDir) dir = -dir;
        for (var q = 0; q < blocks; q++) {
          current = wrap360(current + (180 - state.angle)); // 插入块夹角 180−angle
          angleData.push(dir * current);
        }
        if (dpTwirl) {
          dpTwirlFloors.push(beatFloor[j] + DOUBLE_PRESS_TWIRL.floorOffset);
        }
        carry = state.angle * blocks; // 下一块补 Σ(每块 angle)（累加回正）
        panelLog(
          "  (多押插入) beat=" + beats[j] +
            " 押数=" + pressCount +
            " blocks=" + blocks +
            " angle=" + state.angle +
            " carry=" + carry +
            (dpTwirl ? " 双押旋转->floor " + (beatFloor[j] + DOUBLE_PRESS_TWIRL.floorOffset) : ""),
        );
      }
    }
    return { angleData: angleData, beatFloor: beatFloor, dpTwirlFloors: dpTwirlFloors };
  }

  // Pause 时长按拍计（引擎把 duration 看作等待拍数）。相邻 floor 自占 1 拍，
  // 故填补有效间距 diffEff 需等待 diffEff − 1 拍。判断用有效拍差 diffEff > 2。
  function buildActions(beats, beatFloor, multAt) {
    var actions = [];
    for (var j = 0; j < beats.length - 1; j++) {
      var diff = beats[j + 1] - beats[j];
      var mult = multAt(beats[j + 1]);
      var diffEff = diff * mult;
      if (diffEff > 2) {
        var dur = diffEff - 1;
        // 暂停数值修复#1：(1,2) 向上取整为 2，(2,3) 向下取整为 2。
        if (config.pauseFix1) {
          if (dur > 1 && dur < 2) dur = 2;
          else if (dur > 2 && dur < 3) dur = 2;
        }
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
  function checkSmallAngles(beats, counts, beatFloor, multiPlan, multAt) {
    var out = [];
    var state = { multiType: "single", maxKeys: 3, angle: 15 };
    var lastWarnBeat = null;
    for (var j = 0; j < beats.length; j++) {
      var mp = multiPlan[beats[j]];
      if (mp) state = { multiType: mp.multiType, maxKeys: mp.maxKeys, angle: mp.angle };
      if (j === 0) continue;
      var diff = beats[j] - beats[j - 1];
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

    var built = buildAngleData(beats, counts, multiPlan, multAt, twirlSet);
    var actions = buildActions(beats, built.beatFloor, multAt);
    actions = actions.concat(buildSetSpeed(beats, built.beatFloor, bpmPoints, baseBpm, settings));
    actions = actions.concat(buildTwirl(beats, built.beatFloor, twirlSet));
    for (var dp = 0; dp < built.dpTwirlFloors.length; dp++) {
      actions.push({ floor: built.dpTwirlFloors[dp], eventType: "Twirl" });
      panelLog("Twirl(双押旋转测试): floor " + built.dpTwirlFloors[dp]);
    }
    actions.sort(function (a, b) {
      if (a.floor !== b.floor) return a.floor - b.floor;
      var order = { SetSpeed: 0, Twirl: 1, Pause: 2 };
      return (order[a.eventType] || 3) - (order[b.eventType] || 3);
    });

    var idxByBeat = {};
    for (var bi = 0; bi < beats.length; bi++) idxByBeat[beats[bi]] = bi;
    var warnings = [];
    warnings = warnings.concat(checkBpmRange(baseBpm, bpmPoints, built.beatFloor, idxByBeat));
    warnings = warnings.concat(checkSmallAngles(beats, counts, built.beatFloor, multiPlan, multAt));

    return {
      obj: {
        angleData: built.angleData,
        settings: settings,
        actions: actions,
        decorations: [],
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
      window.alert("导出被拒绝：\n" + level.error);
      return;
    }
    if (level.warnings && level.warnings.length) {
      for (var wi = 0; wi < level.warnings.length; wi++) {
        api.log("adofai warn: " + level.warnings[wi]);
      }
      var shown = level.warnings.slice(0, 20);
      var msg = "导出检查（仅提醒，不阻拦导出）：\n\n" + shown.join("\n");
      if (level.warnings.length > shown.length) {
        msg += "\n… 另有 " + (level.warnings.length - shown.length) + " 处，详见日志。";
      }
      window.alert(msg);
    }
    var content = JSON.stringify(level.obj, null, 2);
    api.system
      .saveFile({
        title: "Export as ADOFAI level",
        defaultPath: "level.adofai",
        filters: [{ name: "ADOFAI level", extensions: ["adofai"] }],
      })
      .then(function (res) {
        if (res.canceled || !res.filePath) return;
        return api.system.writeText(res.filePath, content);
      })
      .then(function (ok) {
        api.log("adofai export:", ok ? "saved" : "write failed");
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

      var dpTwirlToggle = document.createElement("input");
      dpTwirlToggle.type = "checkbox";
      dpTwirlToggle.checked = config.doublePressTwirl;
      dpTwirlToggle.addEventListener("change", function () {
        config.doublePressTwirl = dpTwirlToggle.checked;
        saveConfig();
        api.log("adofai: doublePressTwirl ->", config.doublePressTwirl);
      });
      wrap.appendChild(panelRow("双押旋转（测试）", dpTwirlToggle));

      var hint = document.createElement("div");
      hint.style.opacity = "0.6";
      hint.style.fontSize = "12px";
      hint.style.marginTop = "8px";
      hint.textContent =
        "偏移：SetSpeed 的 floor 相加（正数往后挪格）；修复#1：暂停 (1,2)→2、(2,3)→2；" +
        "双押旋转（测试）：多押(multi) 且押数=2 时，在插入块所在格生成 Twirl 并翻转角度符号。";
      wrap.appendChild(hint);

      return function unmount() {
        host.textContent = "";
      };
    },
  });

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
