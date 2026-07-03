import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const mobileMediaMatch = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\n\}/);
if (!mobileMediaMatch) {
  throw new Error("Expected a mobile @media (max-width: 640px) block in app/globals.css");
}

const mobileCss = mobileMediaMatch[1];

const selectorBlockPattern = /input\s*,\s*\n\s*textarea\s*,\s*\n\s*select\s*,\s*\n\s*\[contenteditable="true"\]\s*\{[\s\S]*?font-size:\s*(?:16px|max\(16px,\s*1rem\))(?:\s*!important)?;[\s\S]*?\}/;

if (!selectorBlockPattern.test(mobileCss)) {
  throw new Error(
    "Expected mobile input, textarea, select, and contenteditable controls to use at least 16px font-size to prevent iOS focus zoom"
  );
}

console.log("Mobile form controls use a no-zoom font size.");
