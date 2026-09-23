import { describe, expect, it, vi } from "vitest";
import { notifyLocalItemWrite, registerLocalItemWriteHandler } from "./syncWrite";

describe("syncWrite bridge", () => {
  it("przekazuje lokalny zapis do zarejestrowanego handlera", () => {
    const handler = vi.fn();
    registerLocalItemWriteHandler(handler);
    notifyLocalItemWrite("abc");
    expect(handler).toHaveBeenCalledWith("abc");
    registerLocalItemWriteHandler(null);
    notifyLocalItemWrite("abc");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignoruje puste id", () => {
    const handler = vi.fn();
    registerLocalItemWriteHandler(handler);
    notifyLocalItemWrite("");
    expect(handler).not.toHaveBeenCalled();
    registerLocalItemWriteHandler(null);
  });
});
