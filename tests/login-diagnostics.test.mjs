import assert from "node:assert/strict";
import test from "node:test";

import { appendLoginDiagnostic, formatLoginDiagnostics } from "../app/login-diagnostics.ts";

test("login diagnostics redact credentials and identity values", () => {
  const entries = appendLoginDiagnostic([], "request_failed", {
    path: "/api/auth/login",
    email: "person@geekforest.ai",
    password: "NeverCopyThisPassword",
    code: "123456",
    token: "secret-token",
    error: "HTTP_502",
  }, "2026-09-22T08:00:00.000Z");
  const text = formatLoginDiagnostics(entries, {
    version: "V162",
    capturedAt: "2026-09-22T08:00:01.000Z",
    path: "/",
    online: true,
    language: "zh-CN",
    userAgent: "Test Browser",
  });

  assert.match(text, /request_failed/);
  assert.match(text, /HTTP_502/);
  assert.match(text, /email=\[redacted\]/);
  assert.match(text, /password=\[redacted\]/);
  assert.match(text, /code=\[redacted\]/);
  assert.match(text, /token=\[redacted\]/);
  assert.doesNotMatch(text, /person@geekforest\.ai|NeverCopyThisPassword|123456|secret-token/);
});

test("login diagnostics remain bounded to the most recent events", () => {
  let entries = [];
  for (let index = 0; index < 60; index += 1) {
    entries = appendLoginDiagnostic(entries, `event_${index}`, { index }, `2026-09-22T08:00:${String(index).padStart(2, "0")}.000Z`);
  }
  assert.equal(entries.length, 40);
  assert.equal(entries[0].event, "event_20");
  assert.equal(entries.at(-1).event, "event_59");
});

test("login diagnostics redact sensitive values even under generic keys and during formatting", () => {
  const entries = [{
    at: "2026-09-22T08:00:00.000Z",
    event: "upstream_error",
    details: {
      valueA: "Cookie: session=abc123; theme=dark",
      valueB: "Authorization: Basic dXNlcjpwYXNz",
      valueC: "session_id=private-session-id",
      valueD: "123456",
      valueE: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signaturevalue",
      valueF: "abcdefghijklmnopqrstuvwxyz012345",
      password: "hunter2",
      token: "short-token",
      code: "12345",
      credential: "abc123",
      sessionId: "session-short",
      session_id: "session-snake",
      sid: "sid-short",
    },
  }];
  const text = formatLoginDiagnostics(entries, {
    version: "V162",
    capturedAt: "2026-09-22T08:00:01.000Z",
    path: "/",
    online: true,
    language: "zh-CN",
    userAgent: "Test Browser",
  });

  assert.doesNotMatch(text, /hunter2|short-token|12345|abc123|session-short|session-snake|sid-short|dXNlcjpwYXNz|private-session-id|123456|eyJhbGci|abcdefghijklmnopqrstuvwxyz012345/);
  assert.match(text, /Cookie: \[redacted\]/);
  assert.match(text, /Authorization: \[redacted\]/);
  assert.match(text, /session_id=\[redacted\]/);
  assert.match(text, /\[redacted-code\]/);
  assert.match(text, /\[redacted-token\]/);
});

test("login diagnostics redact camelCase and snake_case session identifiers on append", () => {
  const text = formatLoginDiagnostics(appendLoginDiagnostic([], "probe", {
    sessionId: "abc123",
    session_id: "def456",
    sid: "xyz789",
    JSESSIONID: "java-session",
    PHPSESSID: "php-session",
  }), {
    version: "V162",
    capturedAt: "2026-09-22T08:00:01.000Z",
    path: "/",
    online: true,
    language: "zh-CN",
    userAgent: "Test Browser",
  });
  assert.doesNotMatch(text, /abc123|def456|xyz789|java-session|php-session/);
});
