import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockSgSend } = vi.hoisted(() => ({ mockSgSend: vi.fn() }));
vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: mockSgSend,
  },
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  })),
}));

import { sendEmail } from "@/lib/email/sendgrid";

const GOOD_RESPONSE = [{ headers: { "x-message-id": "msg-123" } }, {}];

describe("sendEmail staging redirect", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENDGRID_API_KEY = "test-key";
    process.env.SENDGRID_FROM_EMAIL = "noreply@opollo.com";
    mockSgSend.mockResolvedValue(GOOD_RESPONSE);
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.STAGING_EMAIL_RECIPIENT;
    process.env.SENDGRID_API_KEY = origEnv.SENDGRID_API_KEY ?? "";
    process.env.SENDGRID_FROM_EMAIL = origEnv.SENDGRID_FROM_EMAIL ?? "";
  });

  it("sends to real recipient in production", async () => {
    delete process.env.APP_ENV;
    await sendEmail({ to: "real@client.com", subject: "Hello", html: "<p>hi</p>", text: "hi" });
    const msg = (mockSgSend.mock.calls[0] as [{ to: string; subject: string }])[0];
    expect(msg.to).toBe("real@client.com");
    expect(msg.subject).toBe("Hello");
  });

  it("redirects to staging recipient and prefixes subject in staging", async () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_EMAIL_RECIPIENT = "staging@opollo.com";
    await sendEmail({ to: "real@client.com", subject: "Hello", html: "<p>hi</p>", text: "hi" });
    const msg = (mockSgSend.mock.calls[0] as [{ to: string; subject: string }])[0];
    expect(msg.to).toBe("staging@opollo.com");
    expect(msg.subject).toContain("[STAGING");
    expect(msg.subject).toContain("real@client.com");
    expect(msg.subject).toContain("Hello");
  });

  it("sends to real recipient in staging when no STAGING_EMAIL_RECIPIENT set", async () => {
    process.env.APP_ENV = "staging";
    delete process.env.STAGING_EMAIL_RECIPIENT;
    await sendEmail({ to: "real@client.com", subject: "Hello", html: "<p>hi</p>", text: "hi" });
    const msg = (mockSgSend.mock.calls[0] as [{ to: string; subject: string }])[0];
    expect(msg.to).toBe("real@client.com");
  });
});
