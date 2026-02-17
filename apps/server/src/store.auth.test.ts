import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore auth persistence", () => {
  it("creates and upserts users by email", () => {
    const store = new RuntimeStore(":memory:");

    const created = store.createUser({
      email: "Admin@Example.com",
      passwordHash: "salt:hash",
      role: "admin"
    });

    expect(created.email).toBe("admin@example.com");
    expect(store.getUserByEmail("ADMIN@example.com")?.id).toBe(created.id);

    const updated = store.upsertUserByEmail({
      email: "admin@example.com",
      passwordHash: "salt:newhash",
      role: "admin"
    });

    expect(updated.id).toBe(created.id);
    expect(store.getUserByEmail("admin@example.com")?.passwordHash).toBe("salt:newhash");
  });

  it("stores sessions and prunes expired sessions", () => {
    const store = new RuntimeStore(":memory:");
    const user = store.createUser({
      email: "lucy@example.com",
      passwordHash: "salt:hash",
      role: "user"
    });

    store.createAuthSession({
      userId: user.id,
      tokenHash: "token-hash-1",
      expiresAt: "2090-01-01T00:00:00.000Z"
    });
    store.createAuthSession({
      userId: user.id,
      tokenHash: "token-hash-2",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    const removed = store.deleteExpiredAuthSessions("2095-01-01T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(store.getAuthSessionByTokenHash("token-hash-1")).toBeNull();
    expect(store.getAuthSessionByTokenHash("token-hash-2")).not.toBeNull();
  });
});
