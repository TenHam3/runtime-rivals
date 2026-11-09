import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@rr/config", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@rr/config");
  });
});
