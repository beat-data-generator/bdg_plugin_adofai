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

  var bpmKey = api.id + ":bpm";
  var multiKey = api.id + ":multi";
  var twirlKey = api.id + ":twirl";

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
      var beat = m.beat;
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
      plan[m.beat] = { multiType: multiType, maxKeys: maxKeys, angle: angle };
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
          beat: m.beat,
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
      if (isTwirlTrack(track)) set[m.beat] = true;
    }
    return set;
  }

  // 展开 floor：普通一个 beat 一块；多押点在该 beat 之后再插块…
  //   multiType = single → 不插（单轨）
  //   midspin → 插 1 块（双押，2 键）
  //   multi   → 插 maxKeys−1 块（最多 maxKeys 键）
  // 状态机模型：处理规则统一——每个 beat 都按「当前多押状态」生成块。
  //   - 多押点会改写当前状态，并从该点起作用于它自己和它后面的所有 beat；
  //   - 后面若再遇到新多押点，则从新点起切换到新状态。
  //   - 初始状态 = 单轨。状态：单轨=不插；中旋=插1块；多押=插 maxKeys−1 块。
  // 插入块角度 = 当前 + (180 − angle)；下一块用 carry 补回 +angle（仓库双押模型）。
  function buildAngleData(beats, counts, multiPlan, multAt, twirlSet) {
    var angleData = [];
    var beatFloor = [];
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
      angleData.push(dir * current);
      beatFloor[j] = angleData.length - 1;

      // 仅当该 beat 本身是「多押」（同 beat ≥2 个音砖）时才处理；
      // 普通单押 beat 一律不处理（即使当前状态是多押）。
      //   单轨 → 合并（不插）；中旋 → 插 1 块；多押 → 插 min(押数, 最大押数) − 1 块。
      var pressCount = counts[beats[j]] || 1;
      var isMultiBeat = pressCount >= 2;
      var blocks = 0;
      if (isMultiBeat && state.multiType !== "single") {
        blocks =
          state.multiType === "midspin"
            ? 1
            : Math.min(pressCount, state.maxKeys) - 1;
        if (blocks < 1) blocks = 1;
      }
      if (blocks > 0) {
        for (var q = 0; q < blocks; q++) {
          current = wrap360(current + (180 - state.angle)); // 插入块夹角度 180−angle
          angleData.push(dir * current);
        }
        carry = state.angle; // 下一块补 +angle（回正）
        panelLog(
          "  (多押插入) beat=" + beats[j] +
            " 押数=" + pressCount +
            " blocks=" + blocks +
            " angle=" + state.angle +
            " carry=" + carry,
        );
      }
    }
    return { angleData: angleData, beatFloor: beatFloor };
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

  function buildSetSpeed(beats, beatFloor, bpmPoints, baseBpm) {
    var arr = [];
    var idxByBeat = {};
    for (var i = 0; i < beats.length; i++) idxByBeat[beats[i]] = i;
    var bpm = baseBpm; // 累积当前 BPM，用于把倍频点的 beatsPerMinute 写成累积后的绝对值
    for (var k = 0; k < bpmPoints.length; k++) {
      var p = bpmPoints[k];
      bpm = p.type === "bpm" ? p.value : bpm * p.value;
      arr.push({
        floor: beatFloor[idxByBeat[p.beat]],
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
    actions = actions.concat(buildSetSpeed(beats, built.beatFloor, bpmPoints, baseBpm));
    actions = actions.concat(buildTwirl(beats, built.beatFloor, twirlSet));
    actions.sort(function (a, b) {
      if (a.floor !== b.floor) return a.floor - b.floor;
      var order = { SetSpeed: 0, Twirl: 1, Pause: 2 };
      return (order[a.eventType] || 3) - (order[b.eventType] || 3);
    });

    return {
      obj: {
        angleData: built.angleData,
        settings: settings,
        actions: actions,
        decorations: [],
      },
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
