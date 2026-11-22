import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Badge, Card, Chip, ChipWrap, SectionTitle, Segmented, Text } from "@/components/ui";
import { ResultRow, type RunRow } from "@/components/ai/LabResultRow";
import type { MapAccount } from "@/services/ai/money-map";

/**
 * Preview of the On-device AI lab's results with sample data (no model, no database).
 * Open /ai-lab in the preview harness (npm run preview). The data is made up.
 */

const PHONE = 390;

const savings: MapAccount = { ref: "A1", accountId: "s", kind: "savings", name: "SBI", digits: "4821", fundedFrom: null, closed: false };
const fd: MapAccount = { ref: "A2", accountId: "f", kind: "FD", name: "SBI", digits: "3667", fundedFrom: "A1", closed: false };
const icici: MapAccount = { ref: "A3", accountId: "i", kind: "savings", name: "ICICI", digits: "304", fundedFrom: null, closed: false };
const icici2: MapAccount = { ref: "A4", accountId: "j", kind: "savings", name: "ICICI", digits: "185", fundedFrom: null, closed: false };

const ROWS: RunRow[] = [
  {
    id: "1",
    sender: "CBSSBI",
    date: Date.parse("2026-11-16"),
    ms: 2900,
    body: "Dear Customer, Your A/C XXXXX903667 has a debit by transfer of Rs 30,155.00 on 16/11/26. Avl Bal Rs 0.00 -SBI",
    raw: '{"txn":true,"type":"debit","amount":30155,"last4":"3667","balance":0,"event":"fd_close","from":"A2","to":"A1"}',
    outcome: {
      kind: "transaction",
      warnings: [],
      result: {
        type: "debit",
        amount: 30155,
        last4: "3667",
        merchant: null,
        balance: 0,
        event: "fd_close",
        from: { ref: "A2", account: fd, inSms: true },
        to: { ref: "A1", account: savings, inSms: false },
      },
    },
  },
  {
    id: "2",
    sender: "BP-ICICIT-S",
    date: Date.parse("2026-11-19"),
    ms: 2700,
    body: "ICICI Bank Acct XX304 debited with Rs 9,615.00 on 19-Nov-26 & Acct XX185 credited.",
    outcome: {
      kind: "transaction",
      warnings: [],
      result: {
        type: "debit",
        amount: 9615,
        last4: "304",
        merchant: null,
        balance: null,
        event: "own_transfer",
        from: { ref: "A3", account: icici, inSms: true },
        to: { ref: "A4", account: icici2, inSms: true },
      },
    },
  },
  {
    id: "3",
    sender: "AD-HDFCBK-S",
    date: Date.parse("2026-11-18"),
    ms: 3100,
    body: "Rs.349 spent on HDFC Bank Card x9528 at RSP*SWIGGY PVT LTD on 2026-11-18.",
    outcome: {
      kind: "transaction",
      warnings: ['"A9" isn\'t one of your accounts, dropped'],
      result: { type: "debit", amount: 349, last4: "9528", merchant: "RSP*SWIGGY PVT LTD", balance: null, event: "spend", from: null, to: null },
    },
  },
  {
    id: "4",
    sender: "AX-ICICIO-T",
    date: Date.parse("2026-11-20"),
    ms: 1200,
    body: "719471 is One-Time Password for INR 824.82 transaction towards AMAZONRECHA using ICICI Card.",
    outcome: { kind: "not_transaction" },
  },
  {
    id: "5",
    sender: "AD-CBSSBI",
    date: Date.parse("2026-11-16"),
    ms: 2500,
    body: "Dear Customer, On request, A/C XXXXX903667 has been closed and proceeds are transferred.",
    outcome: { kind: "rejected", problems: ["No amount"] },
  },
];

export default function AiLabPreview() {
  const [open, setOpen] = useState<string | null>("1");
  const [range, setRange] = useState<"7" | "30" | "90" | "custom">("90");
  return (
    <ScrollView className="bg-background" contentContainerStyle={{ alignItems: "center", paddingVertical: 24 }}>
      <View style={{ width: PHONE, gap: 12, paddingHorizontal: 16 }}>
        <Card>
          <View className="flex-row items-center">
            <View className="flex-1">
              <Text className="text-heading font-semibold text-foreground">Gemini Nano</Text>
              <Text className="text-meta text-muted-foreground">Gemini Nano is on this phone and ready.</Text>
            </View>
            <Badge label="Ready" variant="success" size="md" />
          </View>
        </Card>
        <Card>
          <SectionTitle icon="flask-outline" title="Test on unrecognised messages" hint="Messages Arth couldn't read, newest first" />
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Dates</Text>
          <Segmented
            options={[
              { value: "7" as const, label: "7 days" },
              { value: "30" as const, label: "30 days" },
              { value: "90" as const, label: "90 days" },
              { value: "custom" as const, label: "Dates" },
            ]}
            value={range}
            onChange={setRange}
          />
        </Card>
        <Card>
          <SectionTitle icon="stats-chart-outline" title="Results" hint="50 read · 1.7 s average · 9 in 10 under 3.0 s" />
          <ChipWrap className="mt-3">
            <Chip label="All 50" on />
            <Chip label="Transactions 8" />
            <Chip label="Not transactions 38" />
            <Chip label="Rejected 4" />
          </ChipWrap>
          <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
            <Chip variant="status" label="Spend 4" />
            <Chip variant="status" label="FD closed 1" tone="transfer" />
            <Chip variant="status" label="Own transfer 2" tone="transfer" />
          </View>
          <View className="mt-2">
            {ROWS.map((r, i) => (
              <ResultRow key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} last={i === ROWS.length - 1} />
            ))}
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
