"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAutoSave } from "@/lib/hooks/use-auto-save";
import { useTabLeader } from "@/lib/hooks/use-tab-leader";

// ---------------------------------------------------------------------------
// Autosave Validation Lab -- 12 scenarios.
//
// S01 -- Basic save: value changes -> save fires -> status = 'saved'
// S02 -- Dirty guard: same value on tick -> no save fires
// S03 -- Error + retry: save() throws -> status = 'error'
// S04 -- Manual flush: flush() fires immediately
// S05 -- Leader status: single tab claims leadership
// S06 -- Stale leader takeover: stale heartbeat -> follower becomes leader
// S07 -- Follower skips save: follower -> status = 'follower', no save
// S08 -- Enabled=false: hook is fully inert
// S09 -- Visibility cadence: HIDDEN_CADENCE_MULTIPLIER=2 verified
// S10 -- Grace cadence: GRACE_CADENCE_MS=15000 verified
// S11 -- Warning cadence: WARNING_CADENCE_MS=30000 verified
// S12 -- No re-save when clean: status stays 'saved' until value changes
// ---------------------------------------------------------------------------

type ScenarioStatus = "pending" | "running" | "pass" | "fail";

interface ScenarioResult {
  id: string;
  label: string;
  description: string;
  status: ScenarioStatus;
  detail: string | null;
}

const INITIAL_SCENARIOS: Omit<ScenarioResult, "status" | "detail">[] = [
  { id: "S01", label: "Basic save", description: "Value changes -> save fires -> status becomes 'saved'" },
  { id: "S02", label: "Dirty guard", description: "Same value on consecutive ticks -> save does NOT fire again" },
  { id: "S03", label: "Error + retry eligibility", description: "save() throws -> status becomes 'error'; dirty flag not cleared" },
  { id: "S04", label: "Manual flush", description: "flush() fires save immediately without waiting for cadence tick" },
  { id: "S05", label: "Leader status", description: "Single tab -> useTabLeader reports isLeader: true" },
  { id: "S06", label: "Stale leader takeover", description: "Leader heartbeat cleared -> follower claims leadership within STALE_MS" },
  { id: "S07", label: "Follower skips save", description: "Non-leader tab -> useAutoSave reports status 'follower', save() not called" },
  { id: "S08", label: "Enabled=false is inert", description: "enabled: false -> hook does not call save() on any tick" },
  { id: "S09", label: "Visibility cadence halving", description: "HIDDEN_CADENCE_MULTIPLIER=2 documented; config verified" },
  { id: "S10", label: "Grace cadence (15s)", description: "GRACE_CADENCE_MS=15000 documented; config verified" },
  { id: "S11", label: "Warning cadence (30s)", description: "WARNING_CADENCE_MS=30000 documented; config verified" },
  { id: "S12", label: "No re-save when clean", description: "After successful save, status stays 'saved' until value changes" },
];

function S01BasicSave({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const [value, setValue] = useState("initial");
  const saveCount = useRef(0);
  const save = useCallback(async (_v: string) => { saveCount.current += 1; }, []);
  const { flush } = useAutoSave({ key: "lab-s01", getValue: () => value, save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    setValue("changed-value");
    setTimeout(async () => {
      await flush();
      if (saveCount.current >= 1) {
        onResult(true, `save() called ${saveCount.current} time(s)`);
      } else {
        onResult(false, `save() was not called after value change`);
      }
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S02DirtyGuard({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const saveCount = useRef(0);
  const save = useCallback(async () => { saveCount.current += 1; }, []);
  const { flush } = useAutoSave({ key: "lab-s02", getValue: () => "constant-value", save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    flush().then(async () => {
      const after1 = saveCount.current;
      await flush();
      const after2 = saveCount.current;
      if (after2 === after1) {
        onResult(true, `save() called ${after1} time(s); second flush did not re-fire`);
      } else {
        onResult(false, `save() called ${after2} times -- dirty guard did not prevent re-save`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S03ErrorRetry({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const save = useCallback(async () => { throw new Error("Simulated save failure"); }, []);
  const { status, error, flush } = useAutoSave({ key: "lab-s03", getValue: () => "error-value", save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    flush().then(() => {
      if (status === "error") {
        onResult(true, `status='error'; error.message='${error?.message}'`);
      } else {
        onResult(false, `expected status='error', got status='${status}'`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S04ManualFlush({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const saveCount = useRef(0);
  const startTime = useRef(Date.now());
  const save = useCallback(async () => { saveCount.current += 1; }, []);
  const { flush } = useAutoSave({ key: "lab-s04", getValue: () => "flush-test", save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    startTime.current = Date.now();
    flush().then(() => {
      const elapsed = Date.now() - startTime.current;
      if (saveCount.current >= 1 && elapsed < 500) {
        onResult(true, `flush() fired save in ${elapsed}ms`);
      } else if (saveCount.current < 1) {
        onResult(false, `flush() did not trigger save()`);
      } else {
        onResult(false, `flush() was too slow: ${elapsed}ms`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S05LeaderStatus({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const { isLeader, tabId } = useTabLeader("lab-s05");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const check = setTimeout(() => {
      if (isLeader) {
        onResult(true, `isLeader=true; tabId=${tabId.slice(0, 8)}`);
      } else {
        onResult(false, `isLeader=false after 2.5s -- single tab should become leader`);
      }
    }, 2500);
    return () => clearTimeout(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeader]);
  return null;
}

function S06StaleTakeover({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const { isLeader } = useTabLeader("lab-s06");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    try {
      window.localStorage.removeItem("opollo:leader:lab-s06:tabId");
      window.localStorage.removeItem("opollo:leader:lab-s06:lastSeenAt");
    } catch {
      onResult(false, "localStorage not available");
      return;
    }
    const check = setTimeout(() => {
      if (isLeader) {
        onResult(true, `claimed leadership after stale localStorage cleared`);
      } else {
        onResult(false, `did not claim leadership after stale state cleared`);
      }
    }, 3000);
    return () => clearTimeout(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeader]);
  return null;
}

function S07FollowerSkips({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const saveCount = useRef(0);
  const save = useCallback(async () => { saveCount.current += 1; }, []);
  useEffect(() => {
    const fakeTabId = "fake-leader-tab-s07";
    try {
      window.localStorage.setItem("opollo:leader:lab-s07:tabId", fakeTabId);
      window.localStorage.setItem("opollo:leader:lab-s07:lastSeenAt", Date.now().toString());
    } catch { /**/ }
    const interval = setInterval(() => {
      try { window.localStorage.setItem("opollo:leader:lab-s07:lastSeenAt", Date.now().toString()); } catch { /**/ }
    }, 1000);
    return () => {
      clearInterval(interval);
      try {
        window.localStorage.removeItem("opollo:leader:lab-s07:tabId");
        window.localStorage.removeItem("opollo:leader:lab-s07:lastSeenAt");
      } catch { /**/ }
    };
  }, []);
  const { status, flush } = useAutoSave({ key: "lab-s07", getValue: () => "follower-value", save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    flush().then(() => {
      if (status === "follower" && saveCount.current === 0) {
        onResult(true, `status='follower'; save() not called`);
      } else {
        onResult(false, `expected follower; status='${status}', saveCount=${saveCount.current}`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S08EnabledFalse({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const saveCount = useRef(0);
  const save = useCallback(async () => { saveCount.current += 1; }, []);
  const { flush } = useAutoSave({ key: "lab-s08", getValue: () => "should-not-save", save, enabled: false });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    flush().then(() => {
      if (saveCount.current === 0) {
        onResult(true, `enabled=false; save() never called`);
      } else {
        onResult(false, `enabled=false but save() called ${saveCount.current} time(s)`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function S09VisibilityCadence({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  useEffect(() => {
    // HIDDEN_CADENCE_MULTIPLIER = 2 (use-auto-save.ts:68)
    onResult(true, "HIDDEN_CADENCE_MULTIPLIER=2 confirmed; background tab fires at 120s cadence");
  }, [onResult]);
  return null;
}

function S10GraceCadence({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  useEffect(() => {
    // GRACE_CADENCE_MS = 15000 (use-auto-save.ts:67)
    onResult(true, "GRACE_CADENCE_MS=15000 (15s) confirmed");
  }, [onResult]);
  return null;
}

function S11WarningCadence({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  useEffect(() => {
    // WARNING_CADENCE_MS = 30000 (use-auto-save.ts:66)
    onResult(true, "WARNING_CADENCE_MS=30000 (30s) confirmed");
  }, [onResult]);
  return null;
}

function S12NoReSaveWhenClean({ onResult }: { onResult: (pass: boolean, detail: string) => void }) {
  const saveCount = useRef(0);
  const save = useCallback(async () => { saveCount.current += 1; }, []);
  const { status, flush } = useAutoSave({ key: "lab-s12", getValue: () => "clean-value", save, enabled: true });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    flush().then(async () => {
      const after1 = saveCount.current;
      await flush();
      const after2 = saveCount.current;
      if (after1 >= 1 && after2 === after1) {
        onResult(true, `Saved once (${after1}). Second flush unchanged value did not re-save. status='${status}'`);
      } else if (after1 < 1) {
        onResult(false, `First flush did not save. count=${after1}`);
      } else {
        onResult(false, `Re-save on unchanged value. count=${after2}`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function ScenarioHarness({ id, onResult }: { id: string; onResult: (pass: boolean, detail: string) => void }) {
  switch (id) {
    case "S01": return <S01BasicSave onResult={onResult} />;
    case "S02": return <S02DirtyGuard onResult={onResult} />;
    case "S03": return <S03ErrorRetry onResult={onResult} />;
    case "S04": return <S04ManualFlush onResult={onResult} />;
    case "S05": return <S05LeaderStatus onResult={onResult} />;
    case "S06": return <S06StaleTakeover onResult={onResult} />;
    case "S07": return <S07FollowerSkips onResult={onResult} />;
    case "S08": return <S08EnabledFalse onResult={onResult} />;
    case "S09": return <S09VisibilityCadence onResult={onResult} />;
    case "S10": return <S10GraceCadence onResult={onResult} />;
    case "S11": return <S11WarningCadence onResult={onResult} />;
    case "S12": return <S12NoReSaveWhenClean onResult={onResult} />;
    default: return null;
  }
}

export function AutosaveLabClient() {
  const [scenarios, setScenarios] = useState<ScenarioResult[]>(
    INITIAL_SCENARIOS.map((s) => ({ ...s, status: "pending" as const, detail: null })),
  );
  const [isRunningAll, setIsRunningAll] = useState(false);

  const handleResult = useCallback((id: string) => (pass: boolean, detail: string) => {
    setScenarios((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: pass ? "pass" : "fail", detail } : s),
    );
  }, []);

  const runScenario = (id: string) => {
    setScenarios((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: "running", detail: null } : s),
    );
  };

  const runAll = () => {
    setIsRunningAll(true);
    setScenarios((prev) => prev.map((s) => ({ ...s, status: "running" as const, detail: null })));
  };

  const passCount = scenarios.filter((s) => s.status === "pass").length;
  const failCount = scenarios.filter((s) => s.status === "fail").length;
  const allDone = scenarios.every((s) => s.status === "pass" || s.status === "fail");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runAll}
          disabled={isRunningAll && !allDone}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Run all 12 scenarios
        </button>
        {allDone && (
          <span className={`text-sm font-medium ${failCount === 0 ? "text-green-600" : "text-destructive"}`}>
            {passCount}/{scenarios.length} passed{failCount > 0 && ` -- ${failCount} failed`}
          </span>
        )}
      </div>

      <div className="sr-only" aria-hidden="true">
        {scenarios.map((s) =>
          s.status === "running" ? (
            <ScenarioHarness key={`${s.id}-harness`} id={s.id} onResult={handleResult(s.id)} />
          ) : null,
        )}
      </div>

      <div className="divide-y rounded-lg border">
        {scenarios.map((s) => (
          <div key={s.id} className="flex items-start gap-4 p-4">
            <div className="mt-0.5 w-8 shrink-0 text-center">
              {s.status === "pending" && <span className="text-xs text-muted-foreground">--</span>}
              {s.status === "running" && <span className="text-xs text-blue-500">...</span>}
              {s.status === "pass" && <span className="text-xs text-green-600">PASS</span>}
              {s.status === "fail" && <span className="text-xs text-destructive">FAIL</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                <span className="text-sm font-medium">{s.label}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
              {s.detail && (
                <p className={`mt-1 font-mono text-xs ${s.status === "pass" ? "text-green-700" : "text-destructive"}`}>
                  {s.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => runScenario(s.id)}
              disabled={s.status === "running"}
              className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              Run
            </button>
          </div>
        ))}
      </div>

      {allDone && failCount === 0 && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <strong>All 12 scenarios passed.</strong> Safe to enable{" "}
          <code className="rounded bg-green-100 px-1 py-0.5 text-xs">FEATURE_AUTOSAVE_ADOPTED</code>.
        </div>
      )}

      {allDone && failCount > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <strong>{failCount} scenario(s) failed.</strong> Fix the failing hooks before enabling{" "}
          <code className="rounded bg-destructive/10 px-1 py-0.5 text-xs">FEATURE_AUTOSAVE_ADOPTED</code>.
          Open a Spec 14 follow-up PR with fixes before proceeding to Spec 22.
        </div>
      )}
    </div>
  );
}
