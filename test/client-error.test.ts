import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/client-error/route";

/**
 * /api/client-error is an UNAUTHENTICATED public endpoint that writes into our
 * Sentry quota. It exists because the Sentry browser SDK was ~150 KB gzipped on
 * every route (see lib/observability/report.ts), so the browser posts a small
 * envelope and the server SDK reports it instead.
 *
 * Being unauthenticated is unavoidable - a boundary can fire before a session
 * exists, or when auth is what broke - so everything here is about what the route
 * REFUSES to forward. It always answers 204, deliberately: a reporting endpoint
 * that varies its response is a probe for what our validation accepts. So these
 * assert on whether Sentry was called, never on the status.
 */

const h = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  rateLimit: vi.fn(async () => true),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: h.captureMessage }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: h.rateLimit,
  clientIp: async () => "203.0.113.7",
}));

/** The route reads the raw body with request.text(), so a plain Request suffices. */
function post(body: string): Request {
  return new Request("https://slush.test/api/client-error", {
    method: "POST",
    body,
    headers: { "content-type": "text/plain" },
  });
}

const valid = {
  message: "Cannot read properties of undefined (reading 'trip')",
  digest: "3f2a91bc",
  pathname: "/book/abc/details",
};

beforeEach(() => {
  h.captureMessage.mockClear();
  h.rateLimit.mockClear();
  h.rateLimit.mockImplementation(async () => true);
});

describe("/api/client-error", () => {
  it("forwards a well-formed report and always answers 204", async () => {
    const res = await POST(post(JSON.stringify(valid)) as never);
    expect(res.status).toBe(204);
    expect(h.captureMessage).toHaveBeenCalledTimes(1);

    const [message, options] = h.captureMessage.mock.calls[0];
    // Tagged as client-reported so an operator never reads it as a server stack.
    expect(message).toContain("[client]");
    expect(options.level).toBe("error");
    expect(options.tags.source).toBe("client-boundary");
    expect(options.tags.digest).toBe("3f2a91bc");
    expect(options.extra.pathname).toBe("/book/abc/details");
  });

  it("rate-limits before reporting, so it cannot be used to burn the Sentry quota", async () => {
    h.rateLimit.mockImplementation(async () => false);
    const res = await POST(post(JSON.stringify(valid)) as never);
    expect(res.status).toBe(204);
    expect(h.captureMessage).not.toHaveBeenCalled();
    expect(h.rateLimit).toHaveBeenCalledWith("clientError", "203.0.113.7");
  });

  it("drops unknown keys rather than forwarding them (.strict)", async () => {
    await POST(post(JSON.stringify({ ...valid, cookie: "sb-access-token=..." })) as never);
    expect(h.captureMessage).not.toHaveBeenCalled();
  });

  it("drops a pathname carrying a query string, fragment, host or traversal", async () => {
    for (const pathname of [
      "/dashboard?token=secret",
      "/dashboard#tok",
      "https://evil.test/x",
      "/../../etc/passwd",
      "dashboard",
      "",
    ]) {
      h.captureMessage.mockClear();
      await POST(post(JSON.stringify({ ...valid, pathname })) as never);
      expect(h.captureMessage, `accepted pathname ${JSON.stringify(pathname)}`).not.toHaveBeenCalled();
    }
  });

  it("drops a digest that is not a React digest", async () => {
    for (const digest of ["not-a-digest", "'; drop table payments;--", "x".repeat(40)]) {
      h.captureMessage.mockClear();
      await POST(post(JSON.stringify({ ...valid, digest })) as never);
      expect(h.captureMessage, `accepted digest ${digest}`).not.toHaveBeenCalled();
    }
  });

  it("accepts a report with no digest at all", async () => {
    await POST(post(JSON.stringify({ message: "boom", pathname: "/help" })) as never);
    expect(h.captureMessage).toHaveBeenCalledTimes(1);
    expect(h.captureMessage.mock.calls[0][1].tags.digest).toBeUndefined();
  });

  it("drops an oversized body before parsing it", async () => {
    const huge = JSON.stringify({ ...valid, message: "a".repeat(4000) });
    await POST(post(huge) as never);
    expect(h.captureMessage).not.toHaveBeenCalled();
  });

  it("drops an over-length message that is within the body cap", async () => {
    // Between the schema's 300-char limit and the 2048-byte body cap.
    await POST(post(JSON.stringify({ ...valid, message: "a".repeat(400) })) as never);
    expect(h.captureMessage).not.toHaveBeenCalled();
  });

  it("survives malformed JSON, an empty body and wrong types without throwing", async () => {
    for (const body of ["not json", "", "[]", "null", '{"message":123,"pathname":"/x"}']) {
      h.captureMessage.mockClear();
      const res = await POST(post(body) as never);
      expect(res.status).toBe(204);
      expect(h.captureMessage).not.toHaveBeenCalled();
    }
  });

  it("never 5xxs when Sentry itself throws", async () => {
    h.captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });
    const res = await POST(post(JSON.stringify(valid)) as never);
    expect(res.status).toBe(204);
  });
});
