import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("App", () => {
  it("renders the app shell", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".sw-app")).toBeInTheDocument();
  });

  it("composes titlebar, main area, and footer with placeholder chrome", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".sw-titlebar")).toBeInTheDocument();
    expect(container.querySelector(".sw-main")).toBeInTheDocument();
    expect(container.querySelector(".sw-footer")).toBeInTheDocument();
    expect(screen.getByText("0 ready · 0m")).toBeInTheDocument();
  });
});
