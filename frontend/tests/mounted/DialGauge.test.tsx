import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DialGauge } from "../../src/desk/DialGauge";
import type { DeskGaugeSpec } from "../../src/lib/deskGaugeSpecs";

const base: DeskGaugeSpec = {
  id: "repliesPerHour",
  label: "Replies / hour",
  unit: "replies per hour",
  valueText: "0.54",
  value: 0.54,
  min: 0,
  max: 1,
  zones: [],
  majorSegments: 2,
  minorPerSegment: 4,
  tickLabels: [{ fraction: 0, text: "0" }, { fraction: 1, text: "1" }],
  showFill: true,
  delta: { pct24h: 1.3, pct7d: -6.3 },
  note: "Last 500 marks.",
};

test("exposes a meter with range, unit and both deltas", () => {
  render(<DialGauge spec={base} />);
  const meter = screen.getByRole("meter", { name: "Replies / hour" });
  expect(meter.getAttribute("aria-valuenow")).toBe("0.54");
  expect(meter.getAttribute("aria-valuemin")).toBe("0");
  expect(meter.getAttribute("aria-valuemax")).toBe("1");
  expect(meter.getAttribute("aria-valuetext")).toBe(
    "0.54 replies per hour, up 1.3% over 24h, down 6.3% over 7d",
  );
  expect(meter.getAttribute("title")).toBe("Last 500 marks.");
});

test("rests the needle at the start of an empty dial for a missing value", () => {
  const { container } = render(<DialGauge spec={{ ...base, value: Number.NaN, valueText: "–" }} />);
  const meter = screen.getByRole("meter");
  expect(meter.getAttribute("aria-valuenow")).toBeNull();
  expect(meter.className).toContain("is-empty");
  const needle = container.querySelector<SVGGElement>(".dial-needle");
  expect(needle?.style.transform).toBe("rotate(-210deg)");
});

test("clamps the needle to the end of the scale and tones the dial at the cap", () => {
  const { container } = render(
    <DialGauge spec={{ ...base, value: 99, valueText: "99", tone: "danger" }} />,
  );
  expect(container.querySelector<SVGGElement>(".dial-needle")?.style.transform).toBe("rotate(30deg)");
  expect(screen.getByRole("meter").className).toContain("is-danger");
  expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("1");
});
