"use client";

/**
 * EditorContext — shared state for the v2 template editor.
 *
 * Manages the live template object, selection, dirty state, and undo/redo op log.
 * The op log (§5.1) is added incrementally: U1 has state + selection, U16 adds
 * the full invertible operation log.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import type { Layer, Op, Template, Variant } from "@/lib/image/template-model";
import { applyVariant } from "@/lib/image/variant-utils";

// ─── State ────────────────────────────────────────────────────────────────────

export interface EditorState {
  template: Template;
  selectedLayerId: string | null;
  /**
   * Active variant key (null = base template view).
   * When non-null, the canvas shows the reflowed layout for that variant.
   */
  activeVariantKey: string | null;
  /** Ops for the current unsaved session (undo/redo stack is managed here). */
  past: Op[][];
  future: Op[][];
  isDirty: boolean;
  isSaving: boolean;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type EditorAction =
  | { type: "select"; layerId: string | null }
  | { type: "update_layer"; layerId: string; patch: Partial<Layer> }
  /**
   * update_layer_live: same as update_layer but does NOT push to the undo
   * stack. Used for real-time drag/resize preview so every mouse-move frame
   * doesn't create a separate undo entry. The owning gesture (onDragEnd /
   * onTransformEnd) follows up with a regular update_layer that records the
   * single undoable op for the entire gesture.
   */
  | { type: "update_layer_live"; layerId: string; patch: Partial<Layer> }
  | { type: "update_template_name"; name: string }
  | { type: "reorder_layers"; fromIndex: number; toIndex: number }
  | { type: "add_layer"; layer: Layer; index: number }
  | { type: "remove_layer"; layerId: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "set_saving"; isSaving: boolean }
  | { type: "mark_clean" }
  /** Toggle template.settings.guides (snap guides on/off). */
  | { type: "toggle_guides" }
  /** Switch the active format variant (null = base / square). */
  | { type: "set_active_variant"; variantKey: string | null }
  /** Add or update a variant in template.variants. */
  | { type: "upsert_variant"; variant: Variant };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function applyLayerPatch(layers: Layer[], layerId: string, patch: Partial<Layer>): Layer[] {
  return layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l));
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "select":
      return { ...state, selectedLayerId: action.layerId };

    case "update_layer": {
      const layers = applyLayerPatch(state.template.layers, action.layerId, action.patch);
      // Build a set op for undo history (simplified — full op log in U16).
      const ops: Op[] = Object.entries(action.patch).map(([key, to]) => {
        const from = (state.template.layers.find((l) => l.id === action.layerId) as unknown as Record<string, unknown>)?.[key];
        return { t: "set", id: action.layerId, key, from, to } satisfies Op;
      });
      return {
        ...state,
        template: { ...state.template, layers },
        past: [...state.past, ops],
        future: [],
        isDirty: true,
      };
    }

    case "update_layer_live": {
      // Updates the model in real-time (every drag frame) WITHOUT adding to
      // the undo stack. The Konva gesture's onDragEnd/onTransformEnd must
      // follow up with a regular update_layer to record the undoable op.
      const layers = applyLayerPatch(state.template.layers, action.layerId, action.patch);
      return {
        ...state,
        template: { ...state.template, layers },
        isDirty: true,
      };
    }

    case "update_template_name":
      return {
        ...state,
        template: { ...state.template, name: action.name },
        isDirty: true,
      };

    case "reorder_layers": {
      const layers = [...state.template.layers];
      const [moved] = layers.splice(action.fromIndex, 1);
      layers.splice(action.toIndex, 0, moved);
      const op: Op = { t: "reorder", id: moved.id, from: action.fromIndex, to: action.toIndex };
      return {
        ...state,
        template: { ...state.template, layers },
        past: [...state.past, [op]],
        future: [],
        isDirty: true,
      };
    }

    case "add_layer": {
      const layers = [...state.template.layers];
      layers.splice(action.index, 0, action.layer);
      const op: Op = { t: "add", layer: action.layer, index: action.index };
      return {
        ...state,
        template: { ...state.template, layers },
        past: [...state.past, [op]],
        future: [],
        isDirty: true,
        selectedLayerId: action.layer.id,
      };
    }

    case "remove_layer": {
      const index = state.template.layers.findIndex((l) => l.id === action.layerId);
      if (index === -1) return state;
      const layer = state.template.layers[index];
      const layers = state.template.layers.filter((l) => l.id !== action.layerId);
      const op: Op = { t: "remove", layer, index };
      return {
        ...state,
        template: { ...state.template, layers },
        past: [...state.past, [op]],
        future: [],
        isDirty: true,
        selectedLayerId: state.selectedLayerId === action.layerId ? null : state.selectedLayerId,
      };
    }

    case "undo": {
      if (state.past.length === 0) return state;
      const ops = state.past[state.past.length - 1];
      const past = state.past.slice(0, -1);
      // Apply inverse ops (simplified — full invertible log in U16).
      let layers = [...state.template.layers];
      for (const op of [...ops].reverse()) {
        if (op.t === "set") {
          layers = applyLayerPatch(layers, op.id, { [op.key]: op.from } as Partial<Layer>);
        } else if (op.t === "reorder") {
          const moved = layers[op.to];
          layers.splice(op.to, 1);
          layers.splice(op.from, 0, moved);
        } else if (op.t === "add") {
          layers = layers.filter((l) => l.id !== op.layer.id);
        } else if (op.t === "remove") {
          layers.splice(op.index, 0, op.layer);
        }
      }
      return {
        ...state,
        template: { ...state.template, layers },
        past,
        future: [ops, ...state.future],
        isDirty: past.length > 0,
      };
    }

    case "redo": {
      if (state.future.length === 0) return state;
      const ops = state.future[0];
      const future = state.future.slice(1);
      let layers = [...state.template.layers];
      for (const op of ops) {
        if (op.t === "set") {
          layers = applyLayerPatch(layers, op.id, { [op.key]: op.to } as Partial<Layer>);
        } else if (op.t === "reorder") {
          const moved = layers[op.from];
          layers.splice(op.from, 1);
          layers.splice(op.to, 0, moved);
        } else if (op.t === "add") {
          layers.splice(op.index, 0, op.layer);
        } else if (op.t === "remove") {
          layers = layers.filter((l) => l.id !== op.layer.id);
        }
      }
      return {
        ...state,
        template: { ...state.template, layers },
        past: [...state.past, ops],
        future,
        isDirty: true,
      };
    }

    case "set_saving":
      return { ...state, isSaving: action.isSaving };

    case "mark_clean":
      return { ...state, isDirty: false, past: [], future: [] };

    case "toggle_guides": {
      const current = state.template.settings?.guides !== false;
      return {
        ...state,
        template: {
          ...state.template,
          settings: { ...state.template.settings, guides: !current },
        },
        isDirty: true,
      };
    }

    case "set_active_variant":
      return { ...state, activeVariantKey: action.variantKey };

    case "upsert_variant": {
      const existing = state.template.variants.findIndex(v => v.key === action.variant.key);
      const variants = existing >= 0
        ? state.template.variants.map((v, i) => i === existing ? action.variant : v)
        : [...state.template.variants, action.variant];
      return { ...state, template: { ...state.template, variants }, isDirty: true };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  selectedLayer: Layer | null;
  /** Template as it appears on the canvas for the active variant (reflowed). */
  displayTemplate: Template;
  /** The active Variant object, or null when showing the base template. */
  activeVariant: Variant | null;
  canUndo: boolean;
  canRedo: boolean;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  template,
  children,
}: {
  template: Template;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, {
    template,
    selectedLayerId: null,
    activeVariantKey: null,
    past: [],
    future: [],
    isDirty: false,
    isSaving: false,
  });

  const activeVariant = useMemo(
    () => state.template.variants.find(v => v.key === state.activeVariantKey) ?? null,
    [state.template.variants, state.activeVariantKey],
  );

  // displayTemplate: the template as shown on the canvas.
  // When a variant is active, layers are reflowed + overrides applied.
  const displayTemplate = useMemo((): Template => {
    if (!activeVariant) return state.template;
    const { width, height, layers } = applyVariant(state.template, activeVariant);
    return { ...state.template, width, height, layers };
  }, [state.template, activeVariant]);

  const selectedLayer = useMemo(
    () => displayTemplate.layers.find((l) => l.id === state.selectedLayerId) ?? null,
    [displayTemplate.layers, state.selectedLayerId],
  );

  const value: EditorContextValue = useMemo(
    () => ({
      state,
      dispatch,
      selectedLayer,
      displayTemplate,
      activeVariant,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, selectedLayer, displayTemplate, activeVariant],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
