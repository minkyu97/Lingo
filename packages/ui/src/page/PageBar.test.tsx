import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageBar } from "./PageBar.tsx";

afterEach(cleanup);

describe("PageBar", () => {
  it("says that the page is being translated, and offers the original", () => {
    const onClick = vi.fn();
    render(
      <PageBar
        state="translating"
        label="Translating into 한국어"
        action={{ label: "Show original", onClick }}
        onStop={() => {}}
      />,
    );

    const bar = screen.getByRole("region", { name: "Lingo page translation" });
    expect(bar.textContent).toContain("Translating into 한국어");
    expect(screen.getByRole("status").textContent).toBe(
      "Translating into 한국어",
    );
    // One action. There is no second way out to choose between.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a problem with its way out, and a way to stop", () => {
    const onFix = vi.fn();
    const onStop = vi.fn();
    render(
      <PageBar
        state="problem"
        label="Add a translation engine to translate pages"
        action={{ label: "Open settings", onClick: onFix }}
        onStop={onStop}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Add a translation engine to translate pages",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onFix).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Stop translating" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
