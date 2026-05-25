import { test } from "@playwright/test";
import { signInAsUatBot, UAT_BASE_URL } from "../uat/helpers/auth";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Diagnostic spec for issue #1049.
//
// Captures EVERY request / response / WebSocket frame on /admin/sites for
// 20 seconds after sign-in, then reports any in-flight HTTP request OR
// open WebSocket. Use this when investigating "networkidle never settles"
// regressions or as a baseline check that the staging deployment hasn't
// re-introduced a hanging connection.
//
// Excluded from the regular UAT harness suite (testIgnore in
// playwright.uat.config.ts). Run explicitly:
//   npx playwright test e2e/diagnostics/admin-nav-requests.spec.ts \
//     --config playwright.uat.config.ts
// ---------------------------------------------------------------------------

test.describe("DIAGNOSTIC — admin nav network", () => {
  test("captures all requests + websockets for 20s on /admin/sites", async ({
    page,
  }) => {
    const startedAt = Date.now();
    const requests: Array<{
      url: string;
      method: string;
      startedAt: number;
      respondedAt: number | null;
      status: number | null;
    }> = [];
    const websockets: Array<{
      url: string;
      openedAt: number;
      closedAt: number | null;
      frameCount: number;
    }> = [];

    page.on("request", (req) => {
      requests.push({
        url: req.url(),
        method: req.method(),
        startedAt: Date.now() - startedAt,
        respondedAt: null,
        status: null,
      });
    });

    page.on("response", (resp) => {
      const match = requests.find(
        (r) => r.url === resp.url() && r.respondedAt === null,
      );
      if (match) {
        match.respondedAt = Date.now() - startedAt;
        match.status = resp.status();
      }
    });

    page.on("websocket", (ws) => {
      const entry = {
        url: ws.url(),
        openedAt: Date.now() - startedAt,
        closedAt: null as number | null,
        frameCount: 0,
      };
      websockets.push(entry);
      ws.on("framesent", () => entry.frameCount++);
      ws.on("framereceived", () => entry.frameCount++);
      ws.on("close", () => {
        entry.closedAt = Date.now() - startedAt;
      });
    });

    await signInAsUatBot(page);
    await page.goto(`${UAT_BASE_URL}/admin/sites`);
    // Idle wait — DO NOT use networkidle (the very thing we're diagnosing)
    await page.waitForTimeout(20_000);

    const pending = requests.filter((r) => r.respondedAt === null);
    const openWs = websockets.filter((w) => w.closedAt === null);

    const report = {
      capturedAt: new Date().toISOString(),
      capturedDurationMs: Date.now() - startedAt,
      totalRequests: requests.length,
      pendingRequests: pending.length,
      pendingRequestUrls: pending.map((r) => ({ method: r.method, url: r.url })),
      totalWebsockets: websockets.length,
      openWebsockets: openWs.length,
      openWebsocketUrls: openWs.map((w) => ({
        url: w.url,
        openedAtMs: w.openedAt,
        framesExchanged: w.frameCount,
      })),
    };

    const outDir = join("test-results", "diagnostics");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "admin-nav-requests.json"),
      JSON.stringify(report, null, 2),
    );

    // eslint-disable-next-line no-console
    console.log("=== Admin nav diagnostic ===");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));

    // Soft assertion — log only, never fail. The point is the report.
  });
});
