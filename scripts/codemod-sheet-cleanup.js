/**
 * Removes the animation machinery left behind once a sheet moves onto Sheet.
 *
 *   node scripts/codemod-sheet-cleanup.js [--write] file ...
 *
 * Each migrated file still carries a shared value, an animated style, and handlers that animate
 * out and then call back through runOnJS. Sheet owns the animation now, so those handlers collapse
 * to a direct call - and leaving them would mean the sheet animates twice, or worse, waits on a
 * completion callback for an animation nothing is running.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const NL = String.fromCharCode(10);

/** Index just past the ')' that closes the '(' at `open`. */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  // Only clean files the migration actually converted. Stripping the animation machinery out of a
  // file whose JSX still references it leaves it broken - which is exactly what happened when this
  // ran over the four the migration had skipped.
  if (!s.includes("<Sheet ")) {
    console.log("  not migrated - skipped        " + file.split(path.sep).join("/"));
    continue;
  }
  const before = s;

  // 1. `slideAnim.value = withTiming(...)` -> the callback's body, called directly.
  let guard = 0;
  while (s.includes(".value = withTiming(") && guard++ < 20) {
    const at = s.indexOf(".value = withTiming(");
    const lineStart = s.lastIndexOf(NL, at) + 1;
    const openParen = s.indexOf("(", at);
    const close = matchParen(s, openParen);
    if (close === -1) break;
    let end = close;
    while (end < s.length && s[end] !== ";") end++;
    const call = s.slice(openParen, close);

    // Recover `runOnJS(fn)(args)` from the completion callback, if there is one.
    const m = call.match(/runOnJS\(([A-Za-z_$][\w$.]*)\)\(([^)]*)\)/);
    const indent = s.slice(lineStart, at).match(/^\s*/)[0];
    const replacement = m ? indent + m[1] + "(" + m[2] + ");" : "";
    s = s.slice(0, lineStart) + replacement + s.slice(end + 1);
  }

  // 2. Drop the shared value and the animated style.
  s = s
    .split(NL)
    .filter((l) => !/const \w*(slideAnim|SlideAnim)\w* = useSharedValue\(/.test(l))
    .join(NL);

  const styleAt = s.search(/const \w*animStyle\w* = useAnimatedStyle\(/i);
  if (styleAt !== -1) {
    const open = s.indexOf("(", styleAt);
    const close = matchParen(s, open);
    let end = close;
    while (end < s.length && s[end] !== ";") end++;
    const ls = s.lastIndexOf(NL, styleAt) + 1;
    s = s.slice(0, ls) + s.slice(end + 2);
  }

  // 3. Dependency arrays no longer reference it.
  s = s
    .split(NL)
    .filter((l) => l.trim() !== "slideAnim,")
    .join(NL)
    .replace(/\[\s*slideAnim\s*,\s*/g, "[")
    .replace(/,\s*slideAnim\s*\]/g, "]")
    .replace(/\[\s*slideAnim\s*\]/g, "[]");

  // 4. Prune imports that are now unused.
  const uses = (name) => {
    const re = new RegExp("[^A-Za-z0-9_$.]" + name + "[^A-Za-z0-9_$]", "g");
    return (s.match(re) || []).length;
  };
  for (const name of ["useSharedValue", "withTiming", "runOnJS", "useAnimatedStyle", "Modal", "useSafeAreaInsets", "KeyboardAvoidingView"]) {
    if (uses(name) > 1) continue;
    s = s.replace(new RegExp("\s*" + name + ",", "g"), "");
    s = s.replace(new RegExp(",\s*" + name + "(?=[\s}])", "g"), "");
  }
  // The default reanimated import goes only if Animated itself is unused.
  if (uses("Animated") <= 1) {
    s = s.replace(/import Animated,?\s*\{[^}]*\}\s*from "react-native-reanimated";\s*\n/, "");
    s = s.replace(/import Animated from "react-native-reanimated";\s*\n/, "");
  }
  s = s.replace(/import \{\s*\}\s*from "[^"]+";\s*\n/g, "");
  // `const insets = useSafeAreaInsets();` is dead once Sheet owns the safe-area pad.
  if (uses("insets") <= 1) s = s.split(NL).filter((l) => !/const insets = useSafeAreaInsets\(\);/.test(l)).join(NL);

  // 5. Sheet must be imported.
  if (!/[{,]\s*Sheet\s*[,}]/.test(s)) {
    const m = s.match(/import \{([^}]*)\} from "@\/components\/ui";/);
    if (m) {
      const names = [...new Set(m[1].split(",").map((x) => x.trim()).filter(Boolean).concat(["Sheet"]))].sort();
      s = s.replace(m[0], "import { " + names.join(", ") + ' } from "@/components/ui";');
    } else {
      s = 'import { Sheet } from "@/components/ui";' + NL + s;
    }
  }

  if (s === before) { console.log("  unchanged                     " + file); continue; }
  try {
    babel.parse(s, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    console.log("  WOULD NOT PARSE               " + file + " -> " + e.message);
    continue;
  }
  console.log("  cleaned                       " + file.split(path.sep).join("/"));
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}
