import { Card, ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    getContextualArticles,
    listAllArticles,
    listArticleGroups,
    searchDocs,
    type DocsIndexEntry,
    type DocsSearchHit
} from "@/services/docs";
import { ac } from "@/utils/accent";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";

/**
 * Help Center home. Two modes:
 *   - Empty query → browse all articles alphabetically, or (if a context
 *     key is passed via ?context=X) show contextual articles first.
 *   - Query present → weighted search across phrasings/title/tags/body.
 */
export default function HelpCenterScreen() {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();
  const params = useLocalSearchParams<{ context?: string; q?: string }>();

  const [query, setQuery] = useState(params.q ?? "");

  const contextArticles: DocsIndexEntry[] = useMemo(() => {
    if (!params.context) return [];
    return getContextualArticles(params.context);
  }, [params.context]);

  const hits: DocsSearchHit[] = useMemo(() => {
    if (!query.trim()) return [];
    return searchDocs(query);
  }, [query]);

  const allArticles = useMemo(() => listAllArticles(), []);
  const groups = useMemo(() => listArticleGroups(), []);

  const tint = ac(accent, colorScheme, 500, 200);

  const openArticle = (slug: string) => {
    Keyboard.dismiss();
    router.push(`/settings/help/${slug}` as never);
  };

  return (
    <ScreenContainer safe padTop={false}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Search input */}
        <View
          className="flex-row items-center bg-card rounded-xl px-3 mb-5"
          style={{ height: 44 }}
        >
          <Ionicons
            name="search"
            size={18}
            color={colorScheme === "dark" ? "#A0A0A0" : "#6B7280"}
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ask anything - e.g. how do I back up"
            placeholderTextColor={colorScheme === "dark" ? "#A0A0A0" : "#9CA3AF"}
            className="flex-1 text-sm text-foreground"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons
                name="close-circle"
                size={18}
                color={colorScheme === "dark" ? "#A0A0A0" : "#6B7280"}
              />
            </Pressable>
          )}
        </View>

        {/* Search results */}
        {query.trim().length > 0 && (
          <>
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
              {hits.length === 0 ? "No matches" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
            </Text>
            {hits.length === 0 && (
              <Card className="mb-4">
                <Text className="text-sm text-muted-foreground">
                  Try a different phrasing. You can also browse all articles below.
                </Text>
              </Card>
            )}
            {hits.map((hit) => (
              <ArticleRow
                key={hit.entry.slug}
                entry={hit.entry}
                onPress={() => openArticle(hit.entry.slug)}
                badge={hit.matchedField === "phrasings" ? "Best match" : undefined}
                tint={tint}
                colorScheme={colorScheme}
              />
            ))}
          </>
        )}

        {/* Contextual (when opened via ?context=X with no query) */}
        {query.trim().length === 0 && contextArticles.length > 0 && (
          <>
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
              Related to where you were
            </Text>
            {contextArticles.map((entry) => (
              <ArticleRow
                key={entry.slug}
                entry={entry}
                onPress={() => openArticle(entry.slug)}
                tint={tint}
                colorScheme={colorScheme}
              />
            ))}
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3 mt-4">
              All articles
            </Text>
          </>
        )}

        {/* v16.0.8 — grouped browse-all list (replaces flat alphabetical).
            Groups are defined by user journey in services/docs/index.ts:
            Start here → Track → Plan → Detection → Insights → Personalize
            → Protect. Articles already shown in the "Related to where you
            were" block are filtered out from their groups. */}
        {query.trim().length === 0 && (() => {
          const contextSlugs = new Set(contextArticles.map((c) => c.slug));
          const visibleGroups = groups
            .map((g) => ({
              label: g.label,
              articles: g.articles.filter((a) => !contextSlugs.has(a.slug)),
            }))
            .filter((g) => g.articles.length > 0);
          return visibleGroups.map((group) => (
            <View key={group.label} className="mb-3">
              <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
                {group.label}
              </Text>
              {group.articles.map((entry) => (
                <ArticleRow
                  key={entry.slug}
                  entry={entry}
                  onPress={() => openArticle(entry.slug)}
                  tint={tint}
                  colorScheme={colorScheme}
                />
              ))}
            </View>
          ));
        })()}
      </ScrollView>
    </ScreenContainer>
  );
}

interface RowProps {
  entry: DocsIndexEntry;
  onPress: () => void;
  tint: string;
  badge?: string;
}

function ArticleRow({ entry, onPress, tint, badge, colorScheme }: RowProps & { colorScheme: 'light' | 'dark' }) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-card rounded-xl p-4 mb-2"
    >
      <View className="flex-row items-center mb-1">
        <Text className="flex-1 text-base font-semibold text-foreground">
          {entry.title}
        </Text>
        {badge && (
          <View
            className="rounded-full px-2 py-0.5 ml-2"
            style={{ backgroundColor: tint + "1F" }}
          >
            <Text className="text-label font-medium" style={{ color: tint }}>
              {badge}
            </Text>
          </View>
        )}
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colorScheme === 'dark' ? '#A0A0A0' : '#6B7280'}
          style={{ marginLeft: 6 }}
        />
      </View>
      {entry.summary.length > 0 && (
        <Text className="text-xs text-muted-foreground leading-5">
          {entry.summary}
        </Text>
      )}
    </Pressable>
  );
}
