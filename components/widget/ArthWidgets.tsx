import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp } from "react-native-android-widget";
import { SEMANTIC } from "@/constants/design-tokens";
import type { Scheme, SemanticRole } from "@/constants/design-tokens";
import type { MonthPace, WidgetDueItem, WidgetReviewItem } from "@/services/home-widget";

/**
 * Arth's home-screen widgets (Android). Widgets render natively from a snapshot, not through
 * NativeWind, so colours come straight from the design tokens and icons are inline SVG. Data and
 * the rules for what shows (masking, pace) live in services/home-widget.ts.
 */

export interface WidgetData {
  /** Amounts are masked: "Hide amounts" is on in Arth. */
  masked: boolean;
  /** App lock on: Approve / Reject open Catch Up, to unlock first, instead of acting. */
  locked: boolean;
  toCatchUp: number;
  spent: string;
  budget: string;
  /** Budget minus spent, as a positive amount: what's left, or how far over. */
  left: string;
  perDay: string;
  pace: MonthPace;
  review: WidgetReviewItem[];
  due: WidgetDueItem[];
  updatedAt: string;
}

interface Props {
  data: WidgetData | null;
  scheme: Scheme;
}

/** clickAction values for the review widget's buttons (handled in services/home-widget-task.ts); clickActionData is { expenseId }. */
export const WIDGET_APPROVE = "APPROVE";
export const WIDGET_REJECT = "REJECT";

const LINK = {
  home: "artha://",
  add: "artha://expense/add",
  voice: "artha://?voice=1",
  picture: "artha://expense/from-screenshot",
  catchUp: "artha://expense/catch-up",
  budget: "artha://budget",
};

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  picture: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.5 9.5 0 0 1 12 5c5 0 9 5 10 7a17 17 0 0 1-3.2 4M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
};

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

function palette(scheme: Scheme) {
  const ch = (role: SemanticRole) => SEMANTIC[scheme][role].split(/\s+/).map(Number);
  const rgba = (role: SemanticRole, a = 1): ColorProp => {
    const [r, g, b] = ch(role);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  const hex = (role: SemanticRole) => `#${ch(role).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { rgba, hex };
}

type Palette = ReturnType<typeof palette>;

function Icon({ name, color, size = 18 }: { name: keyof typeof ICON; color: string; size?: number }) {
  return (
    <SvgWidget
      style={{ width: size, height: size }}
      svg={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`}
    />
  );
}

/** A round tinted button holding one icon. */
function IconButton({ p, icon, uri, label, size = 36 }: { p: Palette; icon: keyof typeof ICON; uri: string; label: string; size?: number }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.rgba("primary", 0.14), justifyContent: "center", alignItems: "center" }}
    >
      <Icon name={icon} color={p.hex("primary")} size={Math.round(size * 0.5)} />
    </FlexWidget>
  );
}

/** Icon over a label, for the medium widget's action row. */
function Action({ p, icon, uri, label, badge }: { p: Palette; icon: keyof typeof ICON; uri: string; label: string; badge?: string }) {
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri }} accessibilityLabel={label} style={{ flex: 1, alignItems: "center" }}>
      <FlexWidget
        style={{
          width: 40,
          height: 40,
          borderRadius: 13,
          backgroundColor: badge ? p.rgba("warning", 0.18) : p.rgba("primary", 0.14),
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {badge ? (
          <TextWidget text={badge} style={{ fontSize: 15, fontWeight: "700", color: p.rgba("warning") }} />
        ) : (
          <Icon name={icon} color={p.hex("primary")} />
        )}
      </FlexWidget>
      <TextWidget text={label} style={{ fontSize: 11, color: p.rgba("mutedForeground"), marginTop: 4 }} />
    </FlexWidget>
  );
}

/** Expense, Voice, Picture and Catch up (with the count waiting), along the bottom of the larger widgets. */
function QuickActions({ p, toCatchUp }: { p: Palette; toCatchUp: number }) {
  return (
    <FlexWidget style={{ flexDirection: "row", width: "match_parent" }}>
      <Action p={p} icon="plus" uri={LINK.add} label="Expense" />
      <Action p={p} icon="mic" uri={LINK.voice} label="Voice" />
      <Action p={p} icon="picture" uri={LINK.picture} label="Picture" />
      <Action p={p} icon="check" uri={LINK.catchUp} label="Catch up" badge={toCatchUp > 0 ? (toCatchUp > 99 ? "99+" : String(toCatchUp)) : undefined} />
    </FlexWidget>
  );
}

/** The budget bar with a line where an even spread would be by today. */
function PaceBar({ p, pace, width }: { p: Palette; pace: MonthPace; width: number }) {
  const w = Math.max(40, Math.round(width));
  const fill = Math.min(1, pace.used) * w;
  const color = pace.pace === "exceeded" || pace.pace === "over" ? p.hex("danger") : p.hex("primary");
  const mark = Math.min(w - 2, Math.max(0, pace.elapsed * w - 1));
  return (
    <SvgWidget
      style={{ width: w, height: 12, marginTop: 8 }}
      svg={`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="12" viewBox="0 0 ${w} 12">
        <rect x="0" y="2" width="${w}" height="8" rx="4" fill="${p.hex("border")}"/>
        ${fill > 0 ? `<rect x="0" y="2" width="${Math.max(8, fill)}" height="8" rx="4" fill="${color}"/>` : ""}
        <rect x="${mark}" y="0" width="2" height="12" rx="1" fill="${p.hex("foreground")}"/>
      </svg>`}
    />
  );
}

function Frame({ p, uri, label, children, padding = 14 }: { p: Palette; uri: string; label: string; children: any; padding?: number }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={label}
      style={{ height: "match_parent", width: "match_parent", backgroundColor: p.rgba("card"), borderRadius: 22, padding, flexDirection: "column" }}
    >
      {children}
    </FlexWidget>
  );
}

function Label({ p, text }: { p: Palette; text: string }) {
  return <TextWidget text={text} style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.08, color: p.rgba("mutedForeground") }} />;
}

function Spacer() {
  return <FlexWidget style={{ flex: 1 }} />;
}

function NotLoaded({ p }: { p: Palette }) {
  return (
    <Frame p={p} uri={LINK.home} label="Arth">
      <Label p={p} text="ARTH" />
      <TextWidget text="Open Arth to load" style={{ fontSize: 13, color: p.rgba("mutedForeground"), marginTop: 6 }} />
    </Frame>
  );
}

function catchUpLine(n: number): string {
  return n > 0 ? `${n} to catch up` : "All caught up";
}

function paceLine(d: WidgetData): string {
  const { pace } = d.pace;
  if (pace === "exceeded") return "Over this month's budget";
  if (pace === "over") return "Ahead of pace: slow down a little";
  return `${pace === "under" ? "Under pace" : "On pace"} · ${d.perDay} a day is fine`;
}

// ─── Small (2×2): Catch Up ───

export function CatchUpWidget({ data, scheme }: Props) {
  const p = palette(scheme);
  if (!data) return <NotLoaded p={p} />;
  const has = data.toCatchUp > 0;
  return (
    <Frame p={p} uri={has ? LINK.catchUp : LINK.home} label={`Arth: ${catchUpLine(data.toCatchUp)}`}>
      <Label p={p} text="CATCH UP" />
      <Spacer />
      {has ? (
        <FlexWidget style={{ flexDirection: "column" }}>
          <TextWidget text={String(data.toCatchUp)} style={{ fontSize: 34, fontWeight: "700", color: p.rgba("primary") }} />
          <TextWidget text="to review" style={{ fontSize: 13, color: p.rgba("mutedForeground") }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
          <Icon name="check" color={p.hex("success")} size={22} />
          <TextWidget text="All caught up" style={{ fontSize: 15, fontWeight: "700", color: p.rgba("success"), marginLeft: 6 }} />
        </FlexWidget>
      )}
      <Spacer />
      <FlexWidget style={{ flexDirection: "row", flexGap: 8 }}>
        <IconButton p={p} icon="plus" uri={LINK.add} label="Add an expense" />
        <IconButton p={p} icon="mic" uri={LINK.voice} label="Add by voice" />
      </FlexWidget>
    </Frame>
  );
}

// ─── Medium (4×2): this month ───

export function MonthWidget({ data, scheme, compact, width }: Props & { compact: boolean; width: number }) {
  const p = palette(scheme);
  if (!data) return <NotLoaded p={p} />;
  const { pace } = data.pace;
  const hasBudget = pace !== "none";
  const over = pace === "exceeded";
  const headline = !hasBudget ? data.spent : over ? `${data.left} over` : `${data.left} left`;
  const days = `${data.pace.daysLeft} day${data.pace.daysLeft === 1 ? "" : "s"} left`;
  const label = `Arth: ${hasBudget ? headline : `${data.spent} spent this month`}, ${catchUpLine(data.toCatchUp)}`;

  if (compact) {
    return (
      <Frame p={p} uri={data.toCatchUp > 0 ? LINK.catchUp : LINK.home} label={label} padding={12}>
        <FlexWidget style={{ flexDirection: "row", alignItems: "center", height: "match_parent", width: "match_parent" }}>
          <FlexWidget style={{ flex: 1, flexDirection: "column" }}>
            <TextWidget
              text={hasBudget ? `${headline} · ${days}` : `${data.spent} spent this month`}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 15, fontWeight: "700", color: over ? p.rgba("danger") : p.rgba("foreground") }}
            />
            <TextWidget
              text={catchUpLine(data.toCatchUp)}
              style={{ fontSize: 12, marginTop: 2, color: data.toCatchUp > 0 ? p.rgba("primary") : p.rgba("success") }}
            />
          </FlexWidget>
          <IconButton p={p} icon="plus" uri={LINK.add} label="Add an expense" />
        </FlexWidget>
      </Frame>
    );
  }

  const month = MONTHS[new Date().getMonth()];
  return (
    <Frame p={p} uri={hasBudget ? LINK.budget : LINK.home} label={label}>
      <FlexWidget style={{ flexDirection: "row", width: "match_parent" }}>
        <FlexWidget style={{ flex: 1 }}>
          <Label p={p} text={month} />
        </FlexWidget>
        {data.masked ? <Icon name="eyeOff" color={p.hex("mutedForeground")} size={14} /> : <TextWidget text={days} style={{ fontSize: 12, color: p.rgba("mutedForeground") }} />}
      </FlexWidget>
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", width: "match_parent", marginTop: 4 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={headline} maxLines={1} style={{ fontSize: 22, fontWeight: "700", color: over ? p.rgba("danger") : p.rgba("foreground") }} />
        </FlexWidget>
        <TextWidget
          text={hasBudget ? (data.masked ? `${Math.round(data.pace.used * 100)}% used` : `of ${data.budget}`) : "spent this month"}
          style={{ fontSize: 12, color: p.rgba("mutedForeground") }}
        />
      </FlexWidget>
      {hasBudget ? (
        <FlexWidget style={{ flexDirection: "column" }}>
          <PaceBar p={p} pace={data.pace} width={width - 28} />
          <TextWidget
            text={data.masked ? catchUpLine(data.toCatchUp) : paceLine(data)}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 12, marginTop: 4, color: over || pace === "over" ? p.rgba("danger") : p.rgba("mutedForeground") }}
          />
        </FlexWidget>
      ) : (
        <TextWidget text="Set a budget in Arth to see what's left" style={{ fontSize: 12, marginTop: 4, color: p.rgba("mutedForeground") }} />
      )}
      <Spacer />
      <QuickActions p={p} toCatchUp={data.toCatchUp} />
    </Frame>
  );
}

// ─── Large (4×4): review and dues ───

function RoundAction({ p, icon, role, action, expenseId, label, locked }: { p: Palette; icon: "check" | "x"; role: "success" | "danger"; action: string; expenseId: string; label: string; locked: boolean }) {
  return (
    <FlexWidget
      clickAction={locked ? "OPEN_URI" : action}
      clickActionData={locked ? { uri: LINK.catchUp } : { expenseId }}
      accessibilityLabel={label}
      style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.rgba(role, 0.16), justifyContent: "center", alignItems: "center", marginLeft: 8 }}
    >
      <Icon name={icon} color={p.hex(role)} size={17} />
    </FlexWidget>
  );
}

function Divider({ p }: { p: Palette }) {
  return <FlexWidget style={{ height: 1, width: "match_parent", backgroundColor: p.rgba("border") }} />;
}

export function ReviewWidget({ data, scheme }: Props) {
  const p = palette(scheme);
  if (!data) return <NotLoaded p={p} />;
  const { pace } = data.pace;
  const monthLine =
    pace === "none"
      ? `${data.spent} spent this month`
      : pace === "exceeded"
        ? `${data.left} over budget`
        : `${data.left} left of ${data.budget} · ${data.pace.daysLeft} days`;

  return (
    <Frame p={p} uri={data.toCatchUp > 0 ? LINK.catchUp : LINK.home} label={`Arth: ${catchUpLine(data.toCatchUp)}`}>
      <FlexWidget style={{ flexDirection: "row", width: "match_parent", alignItems: "center" }}>
        <FlexWidget style={{ flex: 1 }}>
          <Label p={p} text={data.toCatchUp > 0 ? `ARTH · ${data.toCatchUp} TO CATCH UP` : "ARTH · ALL CAUGHT UP"} />
        </FlexWidget>
        <TextWidget text={`Updated ${data.updatedAt}`} style={{ fontSize: 11, color: p.rgba("mutedForeground") }} />
      </FlexWidget>
      <TextWidget
        text={monthLine}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 13, marginTop: 4, marginBottom: 6, color: pace === "exceeded" ? p.rgba("danger") : p.rgba("foreground") }}
      />

      {data.review.length === 0 ? (
        <FlexWidget style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10 }}>
          <Icon name="check" color={p.hex("success")} size={18} />
          <TextWidget text="Nothing waiting for review" style={{ fontSize: 13, marginLeft: 8, color: p.rgba("success") }} />
        </FlexWidget>
      ) : (
        data.review.map((r, i) => (
          <FlexWidget key={r.id} style={{ flexDirection: "column", width: "match_parent" }}>
            {i > 0 && <Divider p={p} />}
            <FlexWidget style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, width: "match_parent" }}>
              <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: LINK.catchUp }} style={{ flex: 1, flexDirection: "column" }}>
                <TextWidget
                  text={`${r.amount} · ${r.title}`}
                  maxLines={1}
                  truncate="END"
                  style={{ fontSize: 14, fontWeight: "700", color: r.isCredit ? p.rgba("success") : p.rgba("foreground") }}
                />
                {r.detail ? (
                  <TextWidget text={r.detail} maxLines={1} truncate="END" style={{ fontSize: 12, color: p.rgba("mutedForeground") }} />
                ) : null}
              </FlexWidget>
              <RoundAction p={p} icon="x" role="danger" action={WIDGET_REJECT} expenseId={r.id} label={`Reject ${r.title}`} locked={data.locked} />
              <RoundAction p={p} icon="check" role="success" action={WIDGET_APPROVE} expenseId={r.id} label={`Approve ${r.title}`} locked={data.locked} />
            </FlexWidget>
          </FlexWidget>
        ))
      )}

      {data.due.length > 0 && (
        <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginTop: 8 }}>
          <Label p={p} text="DUE SOON" />
          {data.due.map((d, i) => (
            <FlexWidget key={`${d.title}-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5, width: "match_parent" }}>
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget text={d.title} maxLines={1} truncate="END" style={{ fontSize: 13, color: p.rgba("foreground") }} />
              </FlexWidget>
              <TextWidget text={d.when} style={{ fontSize: 12, marginRight: 10, color: d.overdue ? p.rgba("danger") : p.rgba("warning") }} />
              <TextWidget text={d.amount} style={{ fontSize: 13, fontWeight: "700", color: p.rgba("foreground") }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      )}

      <Spacer />
      <QuickActions p={p} toCatchUp={data.toCatchUp} />
    </Frame>
  );
}
