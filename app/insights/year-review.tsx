import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, Switch, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { Button, Card, FilterChip, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { ShareCard } from "@/components/year-review/ShareCard";
import {
  CategoriesPage,
  DebtPage,
  HisaabPage,
  IntroPage,
  InvestedPage,
  MerchantsPage,
  MonthsPage,
  NetWorthPage,
  SavingsPage,
  StoryPage,
  VsLastYearPage,
} from "@/components/year-review/StoryCards";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { exportYearReviewPDF, sharePDF } from "@/services/reports/report-pdf-export";
import { buildShareLines, getReviewableFYs, getYearReview, type YearReview } from "@/services/reports/year-review";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

export default function YearReviewScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ fy?: string }>();
  const startMonth = getFYStartMonth();
  const [fy, setFy] = useState<number>(() => {
    const p = Number(params.fy);
    return Number.isFinite(p) && p > 0 ? p : getCurrentFY(startMonth) - 1;
  });
  const [fys, setFys] = useState<number[]>([]);
  const [review, setReview] = useState<YearReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const loadSeq = useRef(0);
  const [page, setPage] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [hideAmounts, setHideAmounts] = useState(true);
  const [sharing, setSharing] = useState<"image" | "pdf" | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const shareRef = useRef<View>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const [list, r] = await Promise.all([getReviewableFYs(DEFAULT_USER_ID), getYearReview(DEFAULT_USER_ID, fy)]);
      if (seq !== loadSeq.current) return; // a newer year is already loading
      setFys(list.includes(fy) ? list : [fy, ...list].sort((a, b) => b - a));
      setReview(r);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [fy]);
  // Cached by data version inside getYearReview, so coming back with nothing changed is instant.
  useDataRefresh(load);

  // Pages with nothing to say are left out (no loans → no loans page).
  const pages = useMemo(() => {
    if (!review) return [];
    const r = review;
    const out: { key: string; node: React.ReactNode }[] = [{ key: "intro", node: <IntroPage r={r} /> }];
    if (r.savings) out.push({ key: "savings", node: <SavingsPage r={r} /> });
    if (r.netWorth) out.push({ key: "networth", node: <NetWorthPage r={r} /> });
    if (r.categories.length > 0) out.push({ key: "categories", node: <CategoriesPage r={r} /> });
    if (r.merchants.bySpend.length > 0) out.push({ key: "merchants", node: <MerchantsPage r={r} /> });
    if (r.biggestMonth) out.push({ key: "months", node: <MonthsPage r={r} /> });
    if (r.debt && r.debt.reduced !== 0) out.push({ key: "debt", node: <DebtPage r={r} /> });
    if (r.invested) out.push({ key: "invested", node: <InvestedPage r={r} /> });
    if (r.hisaab) out.push({ key: "hisaab", node: <HisaabPage r={r} /> });
    if (r.vsLastYear && r.vsLastYear.changes.length > 0) out.push({ key: "vs", node: <VsLastYearPage r={r} /> });
    out.push({ key: "share", node: null });
    return out;
  }, [review]);

  const shareLines = useMemo(
    () => (review ? buildShareLines(review, hideAmounts, formatAmount) : []),
    [review, hideAmounts],
  );

  const goTo = (i: number) => {
    setPage(i);
    scrollRef.current?.scrollTo({ x: i * pageWidth, animated: true });
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  };

  const pickFy = (next: number) => {
    setFy(next);
    setPage(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  };

  const shareImage = async () => {
    if (!shareRef.current) return;
    setSharing("image");
    try {
      const uri = await captureRef(shareRef, { format: "png", quality: 1, result: "tmpfile" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share your year" });
      }
    } catch (e) {
      logger.warn("Year review image share failed:", e);
      Alert.alert("Couldn't share", "Something went wrong making the image. Try the PDF instead.");
    } finally {
      setSharing(null);
    }
  };

  const sharePdf = async () => {
    if (!review) return;
    setSharing("pdf");
    try {
      const uri = await exportYearReviewPDF(review, hideAmounts);
      await sharePDF(uri);
    } catch (e) {
      logger.warn("Year review PDF share failed:", e);
      Alert.alert("Couldn't share", "Something went wrong making the PDF.");
    } finally {
      setSharing(null);
    }
  };

  const fyPicker = fys.length > 1 && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0" contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      {fys.map((y) => (
        <FilterChip
          key={y}
          label={y === getCurrentFY(startMonth) ? `${getFYLabel(y, startMonth)} so far` : getFYLabel(y, startMonth)}
          active={y === fy}
          spacing="sm"
          onPress={() => pickFy(y)}
        />
      ))}
    </ScrollView>
  );

  if (failed && !review) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-base font-semibold text-foreground text-center">Couldn't put your year together</Text>
          <View className="mt-4 w-40">
            <Button title="Try again" onPress={() => void load()} />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  if (loading && !review) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Putting your year together..." icon="sparkles-outline" />
      </ScreenContainer>
    );
  }

  if (!review || review.totals.txCount === 0) {
    return (
      <ScreenContainer padTop={false}>
        {fyPicker}
        <View className="flex-1 px-4 pt-2">
          <StoryPage
            eyebrow="Year in review"
            title={`Nothing for ${getFYLabel(fy, startMonth)} yet`}
            subtitle="Once there's spending recorded for this year, your review shows up here."
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      {fyPicker}
      <View className="flex-1" onLayout={(e: LayoutChangeEvent) => setPageWidth(e.nativeEvent.layout.width)}>
        {pageWidth > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {pages.map((p) => (
              <ScrollView key={p.key} style={{ width: pageWidth }} contentContainerStyle={{ flexGrow: 1, paddingTop: 4, paddingBottom: 16 }}>
                {p.key === "share" ? (
                  <View className="px-4">
                    <ShareCard ref={shareRef} fyLabel={review.fyLabel} lines={shareLines} isComplete={review.isComplete} />
                    <Card className="mt-3">
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 mr-3">
                          <Text className="text-sm font-semibold text-foreground">Hide amounts</Text>
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            Shows percentages, counts and names instead of rupees.
                          </Text>
                        </View>
                        <Switch value={hideAmounts} onValueChange={setHideAmounts} accessibilityLabel="Hide amounts" />
                      </View>
                    </Card>
                    <View className="flex-row gap-3 mt-3">
                      <View className="flex-1">
                        <Button title="Share image" onPress={shareImage} loading={sharing === "image"} disabled={sharing != null} />
                      </View>
                      <View className="flex-1">
                        <Button title="Share PDF" variant="outline" onPress={sharePdf} loading={sharing === "pdf"} disabled={sharing != null} />
                      </View>
                    </View>
                  </View>
                ) : (
                  p.node
                )}
              </ScrollView>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Page dots + jump to share */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-row items-center flex-1 flex-wrap">
          {pages.map((p, i) => (
            <View
              key={p.key}
              accessible={false}
              style={{
                width: i === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                marginRight: 4,
                backgroundColor: i === page ? theme.primary : theme.alpha("primary", 0.25),
              }}
            />
          ))}
        </View>
        {page < pages.length - 1 ? (
          <Button title="Next" variant="outline" onPress={() => goTo(page + 1)} />
        ) : (
          <Button title="Start over" variant="outline" onPress={() => goTo(0)} />
        )}
      </View>
    </ScreenContainer>
  );
}
