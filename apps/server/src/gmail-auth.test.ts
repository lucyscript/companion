import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuntimeStore } from "./store.js";
import * as fs from "fs";

describe("Gmail OAuth Integration - RuntimeStore", () => {
  let store: RuntimeStore;
  const testDbPath = "test-gmail-oauth.db";

  beforeEach(() => {
    // Clean up test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new RuntimeStore(testDbPath);
  });

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("Gmail auth storage", () => {
    it("should store and retrieve Gmail auth data", () => {
      const authData = {
        refreshToken: "test_refresh_token_abc123",
        email: "user@gmail.com",
        connectedAt: new Date().toISOString()
      };

      store.setGmailAuth(authData);
      const retrieved = store.getGmailAuth();

      expect(retrieved).toBeDefined();
      expect(retrieved?.refreshToken).toBe(authData.refreshToken);
      expect(retrieved?.email).toBe(authData.email);
      expect(retrieved?.connectedAt).toBe(authData.connectedAt);
      expect(retrieved?.lastSyncedAt).toBeNull();
    });

    it("should return null when no auth data exists", () => {
      const auth = store.getGmailAuth();
      expect(auth).toBeNull();
    });

    it("should update existing auth data", () => {
      const authData1 = {
        refreshToken: "token1",
        email: "user1@gmail.com",
        connectedAt: new Date().toISOString()
      };

      store.setGmailAuth(authData1);
      
      const authData2 = {
        refreshToken: "token2",
        email: "user2@gmail.com",
        connectedAt: new Date().toISOString()
      };

      store.setGmailAuth(authData2);
      const retrieved = store.getGmailAuth();

      expect(retrieved?.refreshToken).toBe(authData2.refreshToken);
      expect(retrieved?.email).toBe(authData2.email);
    });

    it("should update last synced timestamp", () => {
      const authData = {
        refreshToken: "test_refresh_token",
        email: "user@gmail.com",
        connectedAt: new Date().toISOString()
      };

      store.setGmailAuth(authData);
      
      const syncTime = new Date().toISOString();
      store.updateGmailLastSyncedAt(syncTime);

      const retrieved = store.getGmailAuth();
      expect(retrieved?.lastSyncedAt).toBe(syncTime);
    });

    it("should persist data across store instances", () => {
      const authData = {
        refreshToken: "persistent_token",
        email: "persistent@gmail.com",
        connectedAt: new Date().toISOString()
      };

      store.setGmailAuth(authData);

      // Create a new store instance with same db
      const store2 = new RuntimeStore(testDbPath);
      const retrieved = store2.getGmailAuth();

      expect(retrieved?.refreshToken).toBe(authData.refreshToken);
      expect(retrieved?.email).toBe(authData.email);
    });
  });
});

