import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { AnimatedNumber, Appear, Collapse, CrossFade, PressableScale, SegmentedControl } from "@/components/motion";
import { Button, Card, FilterChip, ListRow, Skeleton, Text } from "@/components/ui";

/**
 * Preview of the motion building blocks (components/motion) with sample data, no database.
 * Open /motion in the preview harness (npm run preview). "Replay" remounts everything.
 */
export default function MotionPreview() {
  const [run, setRun] = useState(0);
  return (
    <ScrollView className="bg-background" contentContainerStyle={{ padding: 16 }}>
      <View style={{ width: 390 }}>
        <Button title="Replay" variant="outline" onPress={() => setRun((r) => r + 1)} className="mb-3" />
        <Demo key={run} />
      </View>
    </ScrollView>
  );
}

function Demo() {
  const [type, setType] = useState<"spent" | "received" | "transfer">("spent");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(615000);
  const [chip, setChip] = useState("all");
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <View>
      <Appear index={0}>
        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total value</Text>
          <AnimatedNumber value={total} className="text-title font-bold text-foreground" />
          <View className="flex-row mt-3">
            <Button title="+ ₹50,000" variant="secondary" onPress={() => setTotal((t) => t + 50000)} className="flex-1 mr-2" />
            <Button title="− ₹50,000" variant="secondary" onPress={() => setTotal((t) => t - 50000)} className="flex-1" />
          </View>
        </Card>
      </Appear>

      <Appear index={1}>
        <Card className="mb-3">
          <SegmentedControl
            options={[{ value: "spent", label: "Spent" }, { value: "received", label: "Received" }, { value: "transfer", label: "Transfer" }]}
            value={type}
            onChange={setType}
            accessibilityLabel="Transaction type"
          />
          <View className="flex-row mt-3">
            {["all", "market", "pension", "fd"].map((c) => (
              <FilterChip key={c} label={c} active={chip === c} onPress={() => setChip(c)} />
            ))}
          </View>
        </Card>
      </Appear>

      <Appear index={2}>
        <Card className="mb-3">
          <Button title={open ? "Fewer options" : "More options"} variant="ghost" onPress={() => setOpen((o) => !o)} />
          <Collapse open={open}>
            <ListRow icon="card-outline" title="Payment mode" subtitle="UPI" onPress={() => {}} />
            <ListRow icon="calendar-outline" title="Date" subtitle="Today" onPress={() => {}} />
          </Collapse>
        </Card>
      </Appear>

      <Appear index={3}>
        <Card className="mb-3">
          <CrossFade loading={loading} placeholder={<Skeleton width="100%" height={56} />}>
            <PressableScale onPress={() => {}} accessibilityRole="button" accessibilityLabel="Catch Up">
              <View className="flex-row items-center py-2">
                <Text className="flex-1 text-body font-semibold text-foreground">Catch Up</Text>
                <Text className="text-meta text-muted-foreground">5 to review</Text>
              </View>
            </PressableScale>
          </CrossFade>
        </Card>
      </Appear>
    </View>
  );
}
