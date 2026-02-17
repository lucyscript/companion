import { describe, expect, it } from "vitest";
import {
  AuthService,
  createPasswordHash,
  parseBearerToken,
  verifyPassword
} from "./auth.js";
import { RuntimeStore } from "./store.js";

describe("auth", () => {
  it("creates and verifies password hashes", () => {
    const hash = createPasswordHash("super-secret-password");
    expect(verifyPassword("super-secret-password", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("parses bearer token header", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
    expect(parseBearerToken("bearer xyz")).toBe("xyz");
    expect(parseBearerToken("Token abc")).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it("bootstraps admin and authenticates sessions", () => {
    const store = new RuntimeStore(":memory:");
    const service = new AuthService(store, {
      required: true,
      adminEmail: "admin@example.com",
      adminPassword: "very-strong-password",
      sessionTtlHours: 24
    });

    const admin = service.bootstrapAdminUser();
    expect(admin?.email).toBe("admin@example.com");
    expect(admin?.role).toBe("admin");

    const login = service.login("admin@example.com", "very-strong-password");
    expect(login).not.toBeNull();

    const context = service.authenticateFromAuthorizationHeader(`Bearer ${login!.token}`);
    expect(context).not.toBeNull();
    expect(context?.user.email).toBe("admin@example.com");

    expect(service.logout(login!.token)).toBe(true);
    expect(service.authenticateToken(login!.token)).toBeNull();
  });
});
