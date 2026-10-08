/**
 * The motion system's building blocks. See docs/MOTION_SYSTEM_PROPOSAL.md for where each is used.
 * All timings come from MOTION in constants/design-tokens.js, and all of them respect the phone's
 * "Remove animations" setting.
 */
export { Appear } from "./Appear";
export { AnimatedNumber } from "./AnimatedNumber";
export { PressableScale } from "./PressableScale";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { Collapse } from "./Collapse";
export { CrossFade } from "./CrossFade";
export { GrowIn, Nudge, SpinIn, WipeIn } from "./Entrances";
export { Chevron } from "./Chevron";
export { Pop } from "./Pop";
export { ThinkingDots } from "./ThinkingDots";
export { DriftingShapes } from "./DriftingShapes";
export { EASE, countValue, enterUp, fadeIn, fadeOut, listLayout, popIn, spring, splitLayoutClasses, staggerDelay, timing, usePressScale } from "./motion";
