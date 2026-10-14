import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(path.dirname(__dirname), "server", "public");
const source = fs.readFileSync(path.join(publicDir, "theme-control.js"), "utf8");

function makeElement(tag) {
  const classes = new Set();
  const listeners = {};
  const el = {
    tagName: tag,
    id: "",
    dataset: {},
    style: {
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { delete this[name]; },
      getPropertyValue(name) { return this[name] ?? ""; },
    },
    attrs: {},
    textContent: "",
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k] ?? null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    querySelector() { return makeElement("input"); },
    appendChild(child) { el.children.push(child); if (child.id) registry.set(child.id, child); return child; },
    children: [],
    fire(type) { for (const fn of listeners[type] || []) fn(); },
  };
  Object.defineProperty(el, "className", {
    get() { return [...classes].join(" "); },
    set(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  return el;
}

let registry;

function load({ scrollY = 0, innerHeight = 800 } = {}) {
  registry = new Map();
  const winListeners = {};
  const scrollCalls = [];
  const body = makeElement("body");
  const document = {
    readyState: "complete",
    body,
    documentElement: makeElement("html"),
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
  };
  const window = {
    scrollY,
    innerHeight,
    devicePixelRatio: 1,
    __UBON_THEME__: { setPreference() {} },
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    matchMedia: () => ({ matches: false }),
    scrollTo(arg) { scrollCalls.push(arg); },
    fire(type) { for (const fn of winListeners[type] || []) fn(); },
  };
  window.document = document;
  vm.runInNewContext(source, { window, document, Number, String });
  return { window, scrollCalls, button: () => registry.get("back-to-top-button") };
}

test("back-to-top button is created hidden with a Thai aria-label", () => {
  const { button } = load();
  const btn = button();
  assert.ok(btn, "button mounted");
  assert.equal(btn.tagName, "button");
  assert.equal(btn.type, "button");
  assert.ok(btn.classList.contains("hidden"));
  assert.match(btn.getAttribute("aria-label"), /[\u0e00-\u0e7f]/);
});

test("button shows only after scrolling more than one screen", () => {
  const { window, button } = load({ innerHeight: 800 });
  window.scrollY = 300;
  window.fire("scroll");
  assert.ok(button().classList.contains("hidden"), "exactly 300px stays hidden");
  window.scrollY = 301;
  window.fire("scroll");
  assert.ok(!button().classList.contains("hidden"));
  window.scrollY = 0;
  window.fire("scroll");
  assert.ok(button().classList.contains("hidden"));
});

test("click scrolls to top smoothly", () => {
  const { button, scrollCalls } = load({ scrollY: 5000 });
  button().fire("click");
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls[0].top, 0);
  assert.equal(scrollCalls[0].behavior, "smooth");
});

test("button sits below modal layer (.modal z-index 50)", () => {
  const { button } = load();
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const modalZ = Number(/\.modal \{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
  const buttonZ = Number(/z-index:(\d+)/.exec(button().style.cssText)?.[1]);
  assert.ok(Number.isFinite(modalZ) && Number.isFinite(buttonZ));
  assert.ok(buttonZ < modalZ);
});

test("floating controls share one right offset var and width", () => {
  const { button } = load();
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const themeBlock = /^\.theme-mode-control \{[^}]*\}/m.exec(css)?.[0] || "";
  assert.match(themeBlock, /right:\s*var\(--floating-control-right,\s*12px\)/);
  assert.match(button().style.cssText, /right:var\(--floating-control-right,\s*12px\)/);
  assert.match(button().style.cssText, /width:var\(--floating-control-width/);
  assert.match(css, /--floating-control-width:\s*calc\(0\.88 \* 60px\)/);
  assert.match(css, /\.theme-switch-control \{\s*--scale:\s*0\.88;/);
});

test("back-to-top button is a bordered circle with ▲ over TOP", () => {
  const { button } = load();
  const btn = button();
  const style = btn.style.cssText;
  assert.equal(btn.textContent, "\u25B2\nTOP");
  assert.match(style, /width:var\(--floating-control-width/);
  assert.match(style, /height:var\(--floating-control-width/);
  assert.match(style, /border-radius:50%/);
  assert.match(style, /border:5px solid var\(--accent-2\)/);
  assert.match(style, /background:var\(--back-to-top-bg, #fff\)/);
  assert.match(style, /color:var\(--back-to-top-fg, var\(--accent-2\)\)/);
  assert.match(style, /box-shadow:/);
  assert.match(style, /font-weight:700/);
  assert.match(style, /opacity:1(;|$)/);
  assert.match(style, /right:var\(--floating-control-right, 12px\)/);
  assert.match(style, /z-index:40/);
});

test("back-to-top hover/focus rule swaps colors and shows a focus ring", () => {
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const rule = /#back-to-top-button:hover,\s*#back-to-top-button:focus-visible \{[^}]*\}/.exec(css)?.[0] || "";
  assert.match(rule, /--back-to-top-bg:\s*var\(--accent-2\)/);
  assert.match(rule, /--back-to-top-fg:\s*#fff/);
  assert.match(rule, /outline:\s*3px solid var\(--theme-focus-ring\)/);
});
