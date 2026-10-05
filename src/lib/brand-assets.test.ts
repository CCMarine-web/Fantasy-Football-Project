import { describe, expect, it } from "vitest";
import { managerSlotKey, managerSlug, slotKeyFromFilename, slotSpec } from "./brand-assets";

describe("brand asset slots", () => {
  it("matches inbox files to slots despite case, spaces and download suffixes", () => {
    expect(slotKeyFromFilename("hero-home.png")).toBe("hero-home");
    expect(slotKeyFromFilename("Header_Trade Tribunal (1).PNG")).toBe("header-trade-tribunal");
    expect(slotKeyFromFilename("card-blake-mire.jpeg")).toBe("card-blake-mire");
  });

  it("names manager slots the way /public/managers names photos", () => {
    expect(managerSlug("Michael Barkemeyer")).toBe("michael-barkemeyer");
    expect(managerSlug("José O'Neil Jr.")).toBe("jose-o-neil-jr");
    expect(managerSlotKey("mugshot", "Patrick McManus")).toBe("mugshot-patrick-mcmanus");
  });

  it("knows the size of fixed and per-manager slots, and nothing else", () => {
    expect(slotSpec("hero-home")).toMatchObject({ width: 1536, height: 640, transparent: false });
    expect(slotSpec("award-luckiest-win")).toMatchObject({ transparent: true });
    expect(slotSpec("card-blake-mire")).toMatchObject({ group: "manager", width: 1000, height: 1400 });
    expect(slotSpec("hero-hom")).toBeNull();
    expect(slotSpec("card-")).toBeNull();
  });
});
