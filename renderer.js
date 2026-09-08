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
  var twirlKey = api.id + ":twirl";

  // 只统计音砖轨道（排除 BPM 轨道）：BPM 点只发 SetSpeed，不参与音砖/双押。
  function scanBeats() {
    var s = api.project.snapshot();
    var counts = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = null;
      for (var k2 = 0; k2 < s.tracks.length; k2++) {
        if (s.tracks[k2].id === m.trackId) track = s.tracks[k2];
      }
      if (track && track.type === bpmKey) continue;
      var beat = m.beat;
      if (beat in counts) counts[beat]++;
      else counts[beat] = 1;
    }
    var beats = [];
    for (var b in counts) beats.push(parseFloat(b));
    beats.sort(function (a, b) {
      return a - b;
    });
    var doubleSet = {};
    for (var k in counts) if (counts[k] >= 2) doubleSet[k] = true;
    return { beats: beats, doubleSet: doubleSet };
  }

  // 展开 floor：普通模式一个 beat 一块；双押模式在该 beat 之后再插一块。
  // beatFloor[j] = beats[j] 对应的实际 floor 下标（给 actions 用）。
  // multAt(beat) 返回该位置起的 BPM 倍率，角度用的拍差会乘以它。
  // twirlSet[beat] 表示该 beat 有旋转点：每次旋转 dir 正负镜像（负→正→…）。
  function buildAngleData(beats, doubleSet, useDouble, angle, multAt, twirlSet) {
    var angleData = [];
    var beatFloor = [];
    var current = 0;
    var carry = 0;
    var dir = 1;
    for (var j = 0; j < beats.length; j++) {
      var diff = j === 0 ? 0 : beats[j] - beats[j - 1];
      var mult = j === 0 ? 1 : multAt(beats[j - 1]);
      var diffEff = diff * mult;
      var step = j === 0 ? 0 : wrap360((1 - diffEff) * 180);
      if (twirlSet && twirlSet[beats[j]]) dir = -dir;
      // dir 只作用于真实路径旋转 step；双押插入与 carry 不镜像
      current = wrap360(current + dir * step + carry);
      panelLog(
        "tile#" + j +
          " beat=" + beats[j] +
          (j === 0 ? "" : " diff=" + diff + " mult=" + mult + " diffEff=" + diffEff) +
          " dir=" + dir +
          " step=" + step +
          " carry=" + carry +
          " -> angle=" + current,
      );
      carry = 0;
      angleData.push(dir * current);
      beatFloor[j] = angleData.length - 1;
      if (useDouble && doubleSet[beats[j]]) {
        current = wrap360(current + (180 - angle));
        angleData.push(dir * current);
        panelLog(
          "  (双押插入) angle " + (180 - angle) + " => angle=" + current +
            " carry=" + angle,
        );
        carry = angle;
      }
    }
    return { angleData: angleData, beatFloor: beatFloor };
  }

  // Pause 时长按拍计（引擎把 duration 看作等待拍数）。相邻 floor 自占 1 拍，
  // 故填补有效间距 diffEff 需等待 diffEff - 1 拍。判断用有效拍差 diffEff > 2。
  function buildActions(beats, beatFloor, multAt) {
    var actions = [];
    for (var j = 0; j < beats.length - 1; j++) {
      var diff = beats[j + 1] - beats[j];
      var mult = multAt(beats[j + 1]);
      var diffEff = diff * mult;
      if (diffEff > 2) {
        var dur = diffEff - 1;
        panelLog(
          "Pause: beat " + beats[j] + "->" + beats[j + 1] +
            " diff=" + diff +
            " mult=" + mult +
            " diffEff=" + diffEff +
            " duration=" + dur +
            " floor=" + beatFloor[j + 1],
        );
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

  function readBpmPoints(s) {
    var out = [];
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = null;
      for (var k = 0; k < s.tracks.length; k++) {
        if (s.tracks[k].id === m.trackId) track = s.tracks[k];
      }
      if (track && track.type === bpmKey && m.attrs) {
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

  function buildSetSpeed(beats, beatFloor, bpmPoints) {
    var arr = [];
    var idxByBeat = {};
    for (var i = 0; i < beats.length; i++) idxByBeat[beats[i]] = i;
    for (var k = 0; k < bpmPoints.length; k++) {
      var p = bpmPoints[k];
      var evt = {
        floor: beatFloor[idxByBeat[p.beat]],
        eventType: "SetSpeed",
        speedType: p.type === "bpm" ? "Bpm" : "Multiplier",
        beatsPerMinute: p.type === "bpm" ? p.value : 100,
        bpmMultiplier: p.type === "bpm" ? 1 : p.value,
        angleOffset: 0,
      };
      arr.push(evt);
    }
    return arr;
  }

  function readTwirlBeats(s) {
    var set = {};
    for (var i = 0; i < s.markers.length; i++) {
      var m = s.markers[i];
      var track = null;
      for (var k = 0; k < s.tracks.length; k++) {
        if (s.tracks[k].id === m.trackId) track = s.tracks[k];
      }
      if (track && track.type === twirlKey) set[m.beat] = true;
    }
    return set;
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

    var scan = scanBeats();
    var beats = scan.beats;
    var beatSet = {};
    for (var i = 0; i < beats.length; i++) beatSet[beats[i]] = true;

    var bpmPoints = readBpmPoints(s);
    for (var v = 0; v < bpmPoints.length; v++) {
      if (!(bpmPoints[v].beat in beatSet)) {
        return {
          error:
            "BPM 点 beat " + bpmPoints[v].beat + " 未落在 marker 上，拒绝导出。",
        };
      }
    }

    panelLog(
      "== export baseBpm=" + baseBpm +
        " offset=" + Math.round(s.offsetMs) +
        " song=" + (s.audioName || "") +
        " beats=" + beats.length +
        " mode=" + config.multiPress +
        " doubleAngle=" + config.doubleAngle,
    );
    for (var pp = 0; pp < bpmPoints.length; pp++) {
      panelLog(
        "  BPM点 beat=" + bpmPoints[pp].beat +
          " type=" + bpmPoints[pp].type +
          " value=" + bpmPoints[pp].value +
          " mult=" + (bpmPoints[pp].type === "bpm"
            ? bpmPoints[pp].value / baseBpm
            : bpmPoints[pp].value),
      );
    }

    function bpmToMult(p) {
      return p.type === "bpm" ? p.value / baseBpm : p.value;
    }
    function multAt(beat) {
      var m = 1;
      for (var q = 0; q < bpmPoints.length; q++) {
        if (bpmPoints[q].beat <= beat) m = bpmToMult(bpmPoints[q]);
        else break;
      }
      return m;
    }

    var twirlSet = readTwirlBeats(s);
    for (var b in twirlSet) {
      if (!(b in beatSet)) {
        return { error: "旋转点 beat " + b + " 未落在 marker 上，拒绝导出。" };
      }
    }

    var useDouble = config.multiPress === "double";
    var built = buildAngleData(
      scan.beats,
      scan.doubleSet,
      useDouble,
      config.doubleAngle,
      multAt,
      twirlSet,
    );
    var actions = buildActions(scan.beats, built.beatFloor, multAt);
    actions = actions.concat(buildSetSpeed(scan.beats, built.beatFloor, bpmPoints));
    actions = actions.concat(buildTwirl(scan.beats, built.beatFloor, twirlSet));
    // 同 floor 顺序：先变速、再旋转、最后暂停
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

  api.trackTypes.register({
    id: "twirl",
    trackName: { zh: "ADOFAI 旋转轨道", en: "ADOFAI Twirl Track" },
    pointName: { zh: "旋转点", en: "Twirl" },
    color: "#a78bfa",
    fields: [],
  });

  var config = {
    multiPress: "merge",
    doubleAngle: 15,
  };

  var logEl = null;
  var logLines = [];

  function panelLog(msg) {
    logLines.push(String(msg));
    if (logEl) {
      logEl.textContent = logLines.join("\n");
      logEl.scrollTop = logEl.scrollHeight;
    }
    api.log(msg);
  }

  function selectEl(id, labelText, options, onchange) {
    var label = document.createElement("label");
    label.textContent = labelText;
    var sel = document.createElement("select");
    sel.id = id;
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement("option");
      opt.value = options[i].value;
      opt.textContent = options[i].text;
      sel.appendChild(opt);
    }
    if (onchange) sel.addEventListener("change", onchange);
    label.appendChild(sel);
    return label;
  }

  api.ui.registerPanel({
    id: "adofai-config",
    title: { zh: "ADOFAI 导出设置", en: "ADOFAI Export Options" },
    mount: function mount(host) {
      host.textContent = "";

      var wrap = document.createElement("div");
      host.appendChild(wrap);

      var mp = selectEl(
        "multi-press",
        "多押处理: ",
        [
          { value: "merge", text: "合并" },
          { value: "double", text: "双押" },
          { value: "multi", text: "多押" },
        ],
        function () {
          config.multiPress = mp.querySelector("select").value;
          api.log("multiPress ->", config.multiPress);
        },
      );
      wrap.appendChild(mp);

      var dbl = selectEl(
        "double-angle",
        "双押角度: ",
        [
          { value: 15, text: "15°" },
          { value: 22.5, text: "22.5°" },
          { value: 30, text: "30°" },
        ],
        function () {
          config.doubleAngle = parseFloat(dbl.querySelector("select").value);
          api.log("doubleAngle ->", config.doubleAngle);
        },
      );
      wrap.appendChild(dbl);

      mp.querySelector("select").value = config.multiPress;
      dbl.querySelector("select").value = config.doubleAngle;

      var btnLog = document.createElement("button");
      btnLog.textContent = "清空日志";
      btnLog.addEventListener("click", function () {
        logLines = [];
        logEl.textContent = "";
      });
      wrap.appendChild(btnLog);

      logEl = document.createElement("pre");
      logEl.style.maxHeight = "240px";
      logEl.style.overflowY = "auto";
      logEl.style.whiteSpace = "pre-wrap";
      logEl.style.wordBreak = "break-all";
      logEl.textContent = "";
      wrap.appendChild(logEl);

      return function unmount() {
        logEl = null;
        host.textContent = "";
      };
    },
  });

  api.ui.registerExporter({
    label: { zh: "ADOFAI 关卡 (.adofai)", en: "ADOFAI level (.adofai)" },
    run: doExport,
  });

  api.log("contributions registered");

  return function dispose() {
    api.log("renderer entry disposed");
  };
});
