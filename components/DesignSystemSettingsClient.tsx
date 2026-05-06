"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import { colors as DEFAULTS } from "@/lib/design-system/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Design token fields surfaced in the admin UI.
// ---------------------------------------------------------------------------

type ColorField = { key: string; label: string; dbKey: string };
type TextFieldDef = { key: string; label: string; dbKey: string; placeholder: string };

const COLOR_FIELDS: ColorField[] = [
  { key: "color_pk",  label: "Primary (pk)",      dbKey: "color_pk"  },
  { key: "color_pk2", label: "Primary dark (pk2)", dbKey: "color_pk2" },
  { key: "color_gr",  label: "Green (gr)",         dbKey: "color_gr"  },
  { key: "color_gr2", label: "Green dark (gr2)",   dbKey: "color_gr2" },
  { key: "color_bl",  label: "Blue (bl)",          dbKey: "color_bl"  },
  { key: "color_am",  label: "Amber (am)",         dbKey: "color_am"  },
  { key: "color_rd",  label: "Red (rd)",           dbKey: "color_rd"  },
  { key: "color_bg",  label: "Canvas (bg)",        dbKey: "color_bg"  },
  { key: "color_d1",  label: "Dark 1 (d1)",        dbKey: "color_d1"  },
  { key: "color_d2",  label: "Dark 2 (d2)",        dbKey: "color_d2"  },
  { key: "color_d3",  label: "Dark 3 (d3)",        dbKey: "color_d3"  },
  { key: "color_d4",  label: "Dark 4 (d4)",        dbKey: "color_d4"  },
];

const TEXT_FIELDS: TextFieldDef[] = [
  { key: "font_display", label: "Display font",   dbKey: "font_display", placeholder: "Fredoka"  },
  { key: "font_body",    label: "Body font",      dbKey: "font_body",    placeholder: "Manrope"  },
  { key: "radius",       label: "Border radius",  dbKey: "radius",       placeholder: "0.5rem"   },
];

const DEFAULT_COLOR_MAP: Record<string, string> = {
  color_pk:  DEFAULTS.pk,
  color_pk2: DEFAULTS.pk2,
  color_gr:  DEFAULTS.gr,
  color_gr2: DEFAULTS.gr2,
  color_bl:  DEFAULTS.bl,
  color_am:  DEFAULTS.am,
  color_rd:  DEFAULTS.rd,
  color_bg:  DEFAULTS.bg,
  color_d1:  DEFAULTS.d1,
  color_d2:  DEFAULTS.d2,
  color_d3:  DEFAULTS.d3,
  color_d4:  DEFAULTS.d4,
};

type DbRow = Record<string, string | null>;

type Props = { initial: DbRow | null };

export function DesignSystemSettingsClient({ initial }: Props) {
  const [values, setValues] = useState<DbRow>(initial ?? {});
  const [isPending, startTransition] = useTransition();

  function fieldValue(dbKey: string): string {
    return values[dbKey] ?? "";
  }

  function setField(dbKey: string, value: string) {
    setValues((prev) => ({ ...prev, [dbKey]: value || null }));
  }

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const res = await fetch("/api/admin/design-system-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { data?: DbRow; error?: string };
      if (!res.ok || json.error) {
        toast.error(json.error ?? "Failed to save settings");
        return;
      }
      setValues(json.data ?? {});
      toast.success("Design system settings saved");
    });
  }, [values]);

  const handleReset = useCallback(() => {
    setValues({});
    startTransition(async () => {
      const nulled: DbRow = {};
      [...COLOR_FIELDS, ...TEXT_FIELDS].forEach((f) => {
        nulled[f.dbKey] = null;
      });
      const res = await fetch("/api/admin/design-system-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nulled),
      });
      const json = (await res.json()) as { data?: DbRow; error?: string };
      if (!res.ok || json.error) {
        toast.error(json.error ?? "Failed to reset settings");
        return;
      }
      setValues({});
      toast.success("Design system tokens reset to defaults");
    });
  }, []);

  return (
    <div className="space-y-8">
      {/* Color tokens */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Color tokens</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COLOR_FIELDS.map((f) => {
            const val = fieldValue(f.dbKey);
            const placeholder = DEFAULT_COLOR_MAP[f.key] ?? "#000000";
            return (
              <div key={f.key} className="space-y-1.5">
                <label htmlFor={f.key} className="text-sm text-m2">
                  {f.label}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id={`${f.key}-picker`}
                    aria-label={`${f.label} colour picker`}
                    value={val || placeholder}
                    onChange={(e) => setField(f.dbKey, e.target.value)}
                    className="h-9 w-10 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
                  />
                  <Input
                    id={f.key}
                    value={val}
                    placeholder={placeholder}
                    onChange={(e) => setField(f.dbKey, e.target.value)}
                    className="font-mono text-sm"
                    maxLength={9}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Typography + radius */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">
          Typography &amp; radius
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label htmlFor={f.key} className="text-sm text-m2">
                {f.label}
              </label>
              <Input
                id={f.key}
                value={fieldValue(f.dbKey)}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.dbKey, e.target.value)}
                className="text-sm"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Preview swatch */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Preview</h2>
        <div
          className="flex flex-wrap gap-3 rounded-xl border border-white/10 p-4"
          style={{
            background: fieldValue("color_bg") || DEFAULTS.bg,
          }}
        >
          {COLOR_FIELDS.map((f) => {
            const color = fieldValue(f.dbKey) || DEFAULT_COLOR_MAP[f.key];
            return (
              <div key={f.key} className="flex flex-col items-center gap-1">
                <div
                  className="h-8 w-8 rounded-full border border-white/10"
                  style={{ background: color }}
                  title={f.label}
                />
                <span className="text-xs text-m3">{f.key.replace("color_", "")}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-white/10 pt-6">
        <Button onClick={handleSave} disabled={isPending} className="btn-pk">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          variant="ghost"
          onClick={handleReset}
          disabled={isPending}
          className="text-destructive hover:text-destructive"
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
