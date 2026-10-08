import { useCallback } from "react";
import { Platform } from "react-native";
import { Easing, FadeIn, FadeInUp, FadeOut, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { MOTION } from "@/constants/design-tokens";

/**
 * Shared motion plumbing for components/motion. Durations, easing and springs all come from the
 * MOTION tokens (constants/design-tokens.js), so every animation in the app moves the same way.
 *
 * Reduce motion: every timing, spring and entering animation here uses ReduceMotion.System, so
 * when the phone's "Remove animations" setting is on Reanimated jumps straight to the end state.
 * Nothing in this folder needs its own check for that, except JS-driven count-ups
 * (AnimatedNumber), which read useReducedMotion() themselves.
 */

/** The one easing curve: cubic-bezier(0.22, 0.61, 0.36, 1). */
export const EASE = Easing.bezier(0.22, 0.61, 0.36, 1);

/** Siblings past this index arrive together, so a long list doesn't take seconds to appear. */
const MAX_STAGGER_INDEX = 8;

export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), MAX_STAGGER_INDEX) * MOTION.stagger;
}

/**
 * Layout (entering / exiting) animations are off on web: Reanimated's web implementation crashes
 * cleaning them up ("reading 'top'" in setElementPosition). Web is only the preview harness; the
 * Android app uses the native implementation. Timing / spring animations still run on web.
 */
const LAYOUT_ANIMATIONS = Platform.OS !== "web";

/** Fade in while lifting 12px, staggered by sibling index. For cards arriving on a screen. */
export function enterUp(index = 0, delay = 0) {
  if (!LAYOUT_ANIMATIONS) return undefined;
  return FadeInUp.duration(MOTION.slow)
    .delay(delay + staggerDelay(index))
    .easing(EASE)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] })
    .reduceMotion(ReduceMotion.System);
}

/** Plain fade in - content replacing a placeholder. */
export function fadeIn(delay = 0) {
  if (!LAYOUT_ANIMATIONS) return undefined;
  return FadeIn.duration(MOTION.base).delay(delay).easing(EASE).reduceMotion(ReduceMotion.System);
}

/** Plain fade out - a placeholder leaving. */
export function fadeOut() {
  if (!LAYOUT_ANIMATIONS) return undefined;
  return FadeOut.duration(MOTION.fast).easing(EASE).reduceMotion(ReduceMotion.System);
}

export function timing(duration: number = MOTION.base) {
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

export function spring(kind: keyof typeof MOTION.spring = "snappy") {
  return { ...MOTION.spring[kind], reduceMotion: ReduceMotion.System };
}

/**
 * Press feedback: shrink to MOTION.pressScale while held, spring back on release. Returns the
 * animated style for a wrapper and the two handlers for the Pressable inside it.
 */
export function usePressScale(enabled = true) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPressIn = useCallback(() => {
    if (enabled) scale.value = withTiming(MOTION.pressScale, timing(100));
  }, [enabled, scale]);
  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, spring("snappy"));
  }, [scale]);
  return { style, onPressIn, onPressOut };
}

/**
 * Split a className into layout utilities (margins, flex, self-alignment, width) and everything
 * else. Layout belongs on the outermost element, so a component that wraps its Pressable in an
 * animated layer still sits in its parent exactly as before, while visual classes (background,
 * border, radius, padding) stay on the Pressable they style. NativeWind never sees an animated
 * component this way.
 */
const LAYOUT_CLASS = /^(-?m[trblxyse]?-|flex-(1|auto|none|initial)$|grow|shrink|basis-|self-|w-|min-w-|max-w-|order-|absolute$|relative$|-?top-|-?bottom-|-?left-|-?right-|z-)/;

export function splitLayoutClasses(className: string): { layout: string; rest: string } {
  const layout: string[] = [];
  const rest: string[] = [];
  for (const c of className.split(/\s+/).filter(Boolean)) {
    (LAYOUT_CLASS.test(c) ? layout : rest).push(c);
  }
  return { layout: layout.join(" "), rest: rest.join(" ") };
}

/** Eased count-up value: easeOutCubic from `from` to `to` at progress t (0..1). */
export function countValue(from: number, to: number, t: number): number {
  const p = Math.min(Math.max(t, 0), 1);
  const e = 1 - Math.pow(1 - p, 3);
  return from + (to - from) * e;
}
