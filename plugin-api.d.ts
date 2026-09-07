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
 */

interface LocaText {
  zh?: string;
  en?: string;
  [locale: string]: string | undefined;
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

  events: {
    on: (
      name: "project" | "selection" | "playhead" | "playing",
      cb: (payload?: unknown) => void,
    ) => () => void;
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
    openWindow: (opts: {
      url: string;
      title?: string;
      width?: number;
      height?: number;
    }) => Promise<void>;
    openPluginsFolder: () => Promise<void>;
  };

  /** Route a free-form call to this plugin's main.js handler. */
  callMain: (method: string, ...args: unknown[]) => Promise<unknown>;
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
