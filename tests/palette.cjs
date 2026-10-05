const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../coolercontrol/main.js"), "utf8",
);
const context = vm.createContext({});
vm.runInContext(source.slice(
  source.indexOf("function nudgePaletteColours("),
  source.indexOf("function sendPalette("),
), context);

const foregroundKeys = [
  "success", "warning", "error", "info", "accent", "accentGradientTo",
  "textColor", "textColorSecondary",
];
const makePalette = (bgOne, bgTwo, foreground) => ({
  bgOne, bgTwo, borderOne: "#123456",
  ...Object.fromEntries(foregroundKeys.map((key) => [key, foreground])),
});
const luminance = (hex) => [0.2126, 0.7152, 0.0722].reduce(
  (total, weight, index) => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return total + weight * (value <= 0.04045
      ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0,
);
const contrast = (foreground, background) =>
  (Math.max(luminance(foreground), luminance(background)) + 0.05) /
  (Math.min(luminance(foreground), luminance(background)) + 0.05);

for (const [name, bgOne, bgTwo, foreground] of [
  ["light", "#ffffff", "#eeeeee", "#aabbcc"],
  ["dark", "#151515", "#262626", "#334455"],
  ["mixed", "#000000", "#ffffff", "#ffffff"],
]) {
  test(`adjusts ${name} colours against both backgrounds`, () => {
    const palette = makePalette(bgOne, bgTwo, foreground);
    context.nudgePaletteColours(palette);
    for (const key of foregroundKeys) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/);
      assert.ok(contrast(palette[key], bgOne) >= 3, key);
      assert.ok(contrast(palette[key], bgTwo) >= 3, key);
    }
    assert.equal(palette.bgOne, bgOne);
    assert.equal(palette.bgTwo, bgTwo);
    assert.equal(palette.borderOne, "#123456");
    const adjusted = { ...palette };
    context.nudgePaletteColours(palette);
    assert.deepEqual(palette, adjusted);
  });
}

test("leaves compliant colours unchanged", () => {
  const palette = makePalette("#ffffff", "#eeeeee", "#123456");
  const original = { ...palette };
  context.nudgePaletteColours(palette);
  assert.deepEqual(palette, original);
});

const decodeChannel = (value) => {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};
const encodeChannel = (value) => 255 * (value <= 0.0031308
  ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
const rgb = (hex) => [1, 3, 5].map((offset) =>
  Number.parseInt(hex.slice(offset, offset + 2), 16),
);

test("solves luminance by scaling the original linear RGB vector", () => {
  const palette = makePalette("#151515", "#262626", "#304050");
  const target = 3 * (luminance(palette.bgTwo) + 0.05) - 0.05;
  const scale = target / luminance(palette.accent);
  const expected = rgb(palette.accent).map((value) =>
    encodeChannel(decodeChannel(value) * scale),
  );
  context.nudgePaletteColours(palette);
  rgb(palette.accent).forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 1);
  });
  assert.ok(contrast(palette.accent, palette.bgTwo) >= 3);
});

test("moves toward white when vector scaling would exceed the gamut", () => {
  const palette = makePalette("#555555", "#555555", "#ff0011");
  const originalLuminance = luminance(palette.accent);
  const target = 3 * (luminance(palette.bgOne) + 0.05) - 0.05;
  const amount = (target - originalLuminance) / (1 - originalLuminance);
  const expected = rgb(palette.accent).map((value) => {
    const linear = decodeChannel(value);
    return encodeChannel(linear + (1 - linear) * amount);
  });
  context.nudgePaletteColours(palette);
  rgb(palette.accent).forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 1);
  });
  assert.ok(contrast(palette.accent, palette.bgOne) >= 3);
});

test("handles black and white without division by zero", () => {
  for (const [background, foreground] of [
    ["#000000", "#000000"], ["#ffffff", "#ffffff"],
  ]) {
    const palette = makePalette(background, background, foreground);
    context.nudgePaletteColours(palette);
    assert.match(palette.accent, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(palette.accent, background) >= 3);
  }
});

test("leaves colours unchanged when the required directions conflict", () => {
  const palette = makePalette("#000000", "#999999", "#222222");
  const original = { ...palette };
  context.nudgePaletteColours(palette);
  assert.deepEqual(palette, original);
});

test("adjusts luminance in the existing foreground direction", () => {
  for (const [background, foreground, direction] of [
    ["#555555", "#666666", 1],
    ["#aaaaaa", "#999999", -1],
  ]) {
    const palette = makePalette(background, background, foreground);
    context.nudgePaletteColours(palette);
    assert.ok(direction * (luminance(palette.accent) - luminance(foreground)) > 0);
    assert.ok(contrast(palette.accent, background) >= 3);
  }
});

test("getPalette adjusts tokens before returning them", () => {
  context.window = {
    parent: { document: { documentElement: {} } },
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({
      getPropertyValue: (property) => property.includes("background")
        ? "#ffffff" : "#bbbbbb",
    }),
  };
  const palette = context.getPalette();
  assert.equal(palette.variant, "light");
  for (const key of foregroundKeys) {
    assert.ok(contrast(palette.tokens[key], palette.tokens.bgOne) >= 3, key);
  }
});
