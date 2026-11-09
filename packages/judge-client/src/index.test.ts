import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@rr/judge-client", () => {
  it("is wired into the workspace", () => {
    expect(PACKAGE_NAME).toBe("@rr/judge-client");
  });
});
