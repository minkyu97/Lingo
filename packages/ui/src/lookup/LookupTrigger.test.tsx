import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LookupTrigger } from "./LookupTrigger.tsx";

afterEach(cleanup);

it("is a named button that reports a press", () => {
  const onClick = vi.fn();
  render(<LookupTrigger onClick={onClick} />);

  fireEvent.click(screen.getByRole("button", { name: "Look up with Lingo" }));
  expect(onClick).toHaveBeenCalledOnce();
});
