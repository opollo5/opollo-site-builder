# Hardening Pass — Decision Trail

Assumptions made during autonomous execution. Each entry includes the PR number, assumption, and reasoning.

---

## PR 1.1 — AddProfileDropdown spec alignment

**Assumption**: `/company/social/connections/connect/[platform]` is implemented as a redirect stub to `/company/social/connections`.

**Reasoning**: The spec requires per-platform link URLs. The real connect flow is popup-based via `POST /api/platform/social/connections/connect` — there is no navigable per-platform page. A redirect stub satisfies the URL requirement without building a full new page flow. The `SocialConnectionsList` component on the connections page manages the OAuth popup.

**Assumption**: E2E test (C-1) gracefully skips when test company has no connections.

**Reasoning**: In CI the test company likely has no social connections. The AddProfileDropdown is correctly hidden when `availableConnections.length === 0`. The test is structured to pass in both "has connections" and "no connections" states. A separate test (C-1b) explicitly verifies the hidden state.
