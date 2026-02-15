import { describe, expect, it } from "vitest";
import { RuntimeStore, RuntimeStorePersistence, RuntimeStoreStateSnapshot } from "./store.js";

class InMemoryPersistence implements RuntimeStorePersistence {
  private snapshot: RuntimeStoreStateSnapshot | null = null;
  saves = 0;

  load(): RuntimeStoreStateSnapshot | null {
    if (!this.snapshot) {
      return null;
    }

    return JSON.parse(JSON.stringify(this.snapshot)) as RuntimeStoreStateSnapshot;
  }

  save(snapshot: RuntimeStoreStateSnapshot): void {
    this.saves += 1;
    this.snapshot = JSON.parse(JSON.stringify(snapshot)) as RuntimeStoreStateSnapshot;
  }
}

describe("RuntimeStore - persistence", () => {
  it("saves state on mutations and rehydrates from persistence", () => {
    const persistence = new InMemoryPersistence();
    const store = new RuntimeStore({ persistence });

    store.setUserContext({ mode: "focus" });
    store.recordJournalEntry("Persistence works");
    store.createDeadline({
      course: "Algorithms",
      task: "Problem Set",
      dueDate: "2026-03-01T12:00:00.000Z",
      priority: "high",
      completed: false
    });

    expect(persistence.saves).toBeGreaterThan(0);

    const rehydrated = new RuntimeStore({ persistence });

    expect(rehydrated.getUserContext().mode).toBe("focus");
    expect(rehydrated.getJournalEntries()).toHaveLength(1);
    expect(rehydrated.getDeadlines()).toHaveLength(1);
    expect(rehydrated.getDeadlines()[0].task).toBe("Problem Set");
  });
});
