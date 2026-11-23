import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { X } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logo } from "../Logo.tsx";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import { Switch } from "./Switch.tsx";
import { TextButton } from "./TextButton.tsx";

afterEach(cleanup);

describe("Icon", () => {
  it("is hidden from assistive technology", () => {
    const { container } = render(<Icon icon={X} size={14} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("14");
  });
});

describe("Button", () => {
  it("is a plain button that reports a press", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Try again</Button>);

    const button = screen.getByRole("button", { name: "Try again" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is named by its label when it has an icon", () => {
    render(<Button icon={X}>Close</Button>);
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });
});

describe("TextButton", () => {
  it("is named by its label, not by its icons", () => {
    render(
      <TextButton leadingIcon={X} trailingIcon={X}>
        Copy
      </TextButton>,
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();
  });
});

describe("IconButton", () => {
  it("is named by its label", () => {
    const onClick = vi.fn();
    render(<IconButton icon={X} label="Close" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Close" });
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("says whether it is on when it is a toggle", () => {
    const { rerender } = render(
      <IconButton icon={X} label="Pin" pressed={false} />,
    );
    const button = screen.getByRole("button", { name: "Pin" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    rerender(<IconButton icon={X} label="Pin" pressed={true} />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "translate", label: "Translate" },
    { value: "define", label: "Define" },
  ] as const;

  it("marks the chosen option and reports a different choice", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Mode"
        options={options}
        value="translate"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("group", { name: "Mode" })).toBeDefined();
    const translate = screen.getByRole("button", { name: "Translate" });
    const define = screen.getByRole("button", { name: "Define" });
    expect(translate.getAttribute("aria-pressed")).toBe("true");
    expect(define.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(translate);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(define);
    expect(onChange).toHaveBeenCalledWith("define");
  });
});

describe("Switch", () => {
  it("reports the opposite of its state when pressed", () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Send context" checked onChange={onChange} />);

    const control = screen.getByRole("switch", { name: "Send context" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Badge", () => {
  it("shows its text", () => {
    render(<Badge>in context</Badge>);
    expect(screen.getByText("in context")).toBeDefined();
  });
});

describe("Logo", () => {
  it("draws the face only in the detailed version", () => {
    const face = render(<Logo />);
    expect(face.container.querySelector('[data-part="face"]')).not.toBeNull();
    face.unmount();

    const plain = render(<Logo detail="plain" size={16} />);
    expect(plain.container.querySelector('[data-part="face"]')).toBeNull();
    expect(plain.container.querySelector("svg")?.getAttribute("width")).toBe(
      "16",
    );
  });
});
