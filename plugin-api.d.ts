/**
 * Ambient type declarations for Beat Data Generator plugin authors.
 *
 * Drop a reference at the top of your renderer.js to get editor hints:
 *   /// <reference path="plugin-api.d.ts" />
 *
 * A plugin is a folder with a manifest.json. Its optional renderer.js must
 * self-register by calling:
 *
 *   window.__bdgPluginRegister(function activate(api) {
 *     // register actions / panels / shortcuts / exporters / importers ...
 *     return function dispose() {}; // optional cleanup
 *   });
 *
 * Its optional main.js is loaded in the main process with full Node access:
 *
 *   module.exports = function activate(ctx) {
 *     ctx.log("hello");
 *     ctx.registerHandler("ping", () => "pong"); // reachable via api.callMain
 *     ctx.onDispose(() => {});
 *   };
 *
 * API versioning: declare the surface you were written against in manifest.json
 * as `"apiVersion": 2`. Omitting it means 1 (legacy). A manifest that asks for a
 * newer version than the host supports is listed but never loaded.
 */

type LocaText =
  | string
  | { zh?: string; en?: string; [locale: string]: string | undefined };

/** Optional host-version constraint, e.g. { "bdg": ">=0.4.0" }. */
interface PluginEngines {
  bdg?: string;
  [key: string]: string | undefined;
}

interface LoopConfig {
  interval: number;
  count: number;
  exclude?: number[];
}

interface ProjectSnapshot {
  name: string;
  baseBpm: number;
  offsetMs: number;
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked: boolean;
  tracks: Array<{
    id: string;
    name: string;
    color: string;
    locked: boolean;
    hidden: boolean;
    type: string;
  }>;
  markers: Array<{
    id: string;
    trackId: string;
    beat: number;
    timeMs: number;
    parentId?: string;
    loop?: LoopConfig | null;
    attrs?: Record<string, unknown>;
  }>;
  bpmPoints: Array<{ id: string; beat: number; mode: "abs" | "mult"; value: number }>;
}

interface SelectionSnapshot {
  kind: "marker" | "bpm" | null;
  id: string | null;
  markerIds: string[];
}

type FieldValue = number | string | boolean;

interface PluginFieldOption {
  value: FieldValue;
  label: LocaText;
}

interface PluginField {
  key: string;
  label: LocaText;
  type: "number" | "string" | "bool" | "enum";
  default?: FieldValue;
  min?: number;
  max?: number;
  step?: number;
  options?: PluginFieldOption[];
}

interface TrackTypeSchema {
  id: string;
  trackName: LocaText;
  pointName: LocaText;
  color?: string;
  fields: PluginField[];
}

interface PanelHandle {
  uid: number;
  dispose: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

interface BarButtonHandle {
  uid: number;
  dispose: () => void;
  /** Programmatically set the pressed state (updates the button). */
  setActive: (v: boolean) => void;
  isActive: () => boolean;
}

interface PluginBarButtonDef {
  id: string;
  title: string | LocaText;
  /** Inline SVG markup for the icon (plugin-authored, rendered as-is). */
  icon?: string;
  /** When true the host flips `active` on click and passes it to `run`. */
  toggle?: boolean;
  /** Initial pressed state (toggle buttons only). */
  active?: boolean;
  /** Sort key; lower sorts further left. */
  order?: number;
  run: (active: boolean) => void | Promise<void>;
}

interface RegisterResult {
  ok: boolean;
  reason?: string;
}

interface PluginApi {
  readonly id: string;
  readonly version: string;
  readonly dir: string;
  log: (...args: unknown[]) => void;

  project: {
    snapshot: () => ProjectSnapshot;
    bpmAtBeat: (beat: number) => number;
    bpmAtTime: (ms: number) => number;
    timeOfBeat: (beat: number) => number;
    beatOfTime: (ms: number) => number;
    /** Markers on every track of the given plugin track type `<pluginId>:<id>`. */
    markersOfType: (typeKey: string) => ProjectSnapshot["markers"];
    /** Tracks of the given plugin track type `<pluginId>:<id>`. */
    tracksOfType: (typeKey: string) => ProjectSnapshot["tracks"];
    /** A single track by id, or null when it does not exist/is hidden. */
    trackById: (id: string) => ProjectSnapshot["tracks"][number] | null;
    edit: {
      addTrack: (opts?: { name?: string }) => string;
      addTypedTrack: (typeKey: string, name?: string) => string | null;
      removeTrack: (trackId: string) => void;
      renameTrack: (trackId: string, name: string) => void;
      setTrackLocked: (trackId: string, v: boolean) => void;
      setTrackHidden: (trackId: string, v: boolean) => void;
      addMarker: (opts: { trackId: string; beat: number }) => string | null;
      moveMarker: (id: string, beat: number) => boolean;
      removeMarker: (id: string) => void;
      setMarkerAttrs: (id: string, attrs: Record<string, unknown>) => void;
      /** Set a main marker's loop group config (undo aware); null clears it. */
      setMarkerLoop: (
        id: string,
        cfg: { interval: number; count: number; exclude?: number[] } | null,
      ) => void;
      addBpmPoint: (beat: number) => string | null;
      removeBpmPoint: (id: string) => void;
      setBaseBpm: (v: number) => void;
      setOffset: (v: number) => void;
      batch: (fn: () => void) => void;
      undo: () => void;
      redo: () => void;
    };
  };

  selection: {
    current: () => SelectionSnapshot;
    selectMarker: (id: string) => void;
    selectBpm: (id: string) => void;
    clear: () => void;
  };

  player: {
    play: () => void;
    pause: () => void;
    togglePlay: () => void;
    stop: () => void;
    seekTo: (ms: number) => void;
    positionMs: () => number;
    durationMs: () => number;
    playing: () => boolean;
    rate: () => number;
  };

  /** Read the decoded audio and swap in a new one (used by audio tools). */
  audio: {
    /** The currently loaded decoded audio, or null when no audio is loaded. */
    getBuffer: () => AudioBuffer | null;
    /**
     * Encode an AudioBuffer to 16-bit PCM WAV bytes. When `startMs`/`endMs` are
     * given only that span is encoded; otherwise the whole buffer.
     */
    encodeWav: (
      buffer: AudioBuffer,
      startMs?: number,
      endMs?: number,
    ) => Uint8Array;
    /**
     * Decode `bytes` and make them the current audio (waveform, relink, MD5,
     * analysis). `autoApply` defaults to false so auto-BPM/beats do not clobber
     * the user's chart after a replace.
     */
    replaceFromBytes: (
      bytes: Uint8Array,
      opts: { filePath: string; name?: string; autoApply?: boolean },
    ) => Promise<boolean>;
  };

  events: {
    on: (
      name: "project" | "selection" | "playhead" | "playing" | "view",
      cb: (payload?: unknown) => void,
    ) => () => void;
  };

  /** Read-only timeline transform, for positioning overlays in time space. */
  timeline: {
    /** Screen x (px inside the editor) of a time in ms. */
    timeToScreenX: (ms: number) => number;
    /** Time in ms at a screen x (px inside the editor). */
    screenToTime: (x: number) => number;
    /** Content x (unscrolled px) of a time in ms. */
    timeToX: (ms: number) => number;
    /** Current scroll offset, viewport size and horizontal zoom. */
    viewport: () => {
      x: number;
      y: number;
      vw: number;
      vh: number;
      pxPerSec: number;
    };
    /** Loaded audio duration in ms (0 when no audio). */
    durationMs: () => number;
  };

  ui: {
    registerAction: (def: {
      label: string | LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    registerPanel: (def: {
      id: string;
      title: string | LocaText;
      mount: (el: HTMLElement) => void | (() => void);
      /** Initial window size in px; the user's own size (once set) wins and persists. */
      defaultWidth?: number;
      defaultHeight?: number;
      /** Lower bounds enforced while the user resizes. */
      minWidth?: number;
      minHeight?: number;
    }) => PanelHandle;
    registerShortcut: (def: {
      id: string;
      label: string | LocaText;
      combo: string;
      run: () => void | Promise<void>;
    }) => () => void;
    registerImporter: (def: {
      label: string | LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    registerExporter: (def: {
      label: string | LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    /**
     * Mount a full-bleed overlay inside the timeline viewport. The container is
     * pointer-events:none; interactive children must opt into pointer-events and
     * stopPropagation so the canvas beneath does not also react. Return an
     * optional cleanup from `mount`.
     */
    registerTimelineOverlay: (def: {
      id: string;
      mount: (el: HTMLElement) => void | (() => void);
      z?: number;
    }) => () => void;
    /**
     * Add a quick-action button to the project bar. Toggle buttons flip their
     * pressed state on click and receive the new value in `run`; use the
     * returned handle's setActive() to drive it programmatically.
     */
    registerBarButton: (def: PluginBarButtonDef) => BarButtonHandle;
    /** Show a transient toast in the editor. */
    notify: (opts: {
      message: string;
      type?: "info" | "success" | "warning" | "error";
      durationMs?: number;
    }) => void;
    openPanel: (uid: number) => void;
    closePanel: (uid: number) => void;
  };

  trackTypes: {
    register: (def: TrackTypeSchema) => RegisterResult;
  };

  system: {
    pickFile: (opts?: {
      title?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<string | null>;
    saveFile: (opts: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ canceled: boolean; filePath?: string }>;
    readText: (
      path: string,
    ) => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
    writeText: (path: string, content: string) => Promise<boolean>;
    /** Read raw bytes from an absolute path; null when missing (audio export). */
    readBytes: (path: string) => Promise<Uint8Array | null>;
    /** Write raw bytes to an absolute path (audio export). */
    writeBytes: (path: string, bytes: Uint8Array) => Promise<boolean>;
    openWindow: (opts: {
      url: string;
      title?: string;
      width?: number;
      height?: number;
    }) => Promise<void>;
    openPluginsFolder: () => Promise<void>;
    /** Absolute filesystem path of the loaded audio, or null when none. */
    audioPath: () => string | null;
  };

  /** Route a free-form call to this plugin's main.js handler. */
  callMain: (method: string, ...args: unknown[]) => Promise<unknown>;

  /**
   * Per-plugin persistent key/value store, scoped to this plugin and saved to
   * disk by the main process. Synchronous get/set like localStorage, but kept
   * out of web storage (namespaced, survives cache clears, written to a real
   * file). Use it for panel preferences and small settings, not large data.
   */
  storage: {
    /** Read a value; returns `def` when the key is absent. */
    get: <T = unknown>(key: string, def?: T) => T;
    /** Write a value (persisted shortly after; coalesced with other writes). */
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    all: () => Record<string, unknown>;
    clear: () => void;
  };
}

interface PluginMainContext {
  id: string;
  dir: string;
  log: (...args: unknown[]) => void;
  registerHandler: (
    name: string,
    fn: (...args: unknown[]) => unknown,
  ) => void;
  onDispose: (fn: () => void) => void;
}

interface Window {
  __bdgPluginRegister?: (activate: (api: PluginApi) => void | (() => void)) => void;
}
