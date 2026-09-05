import { useMemo, useLayoutEffect, useCallback } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ScreenContainer, Text } from "@/components/ui";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { getArticleMeta } from "@/services/docs";
import { loadArticleBody } from "@/services/docs/articles";

export default function HelpArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const navigation = useNavigation();
  const router = useRouter();

  const meta = useMemo(() => (slug ? getArticleMeta(slug) : null), [slug]);
  const body = useMemo(() => (slug ? loadArticleBody(slug) : null), [slug]);

  // v15.2.1: make markdown [label](slug) links tap-navigate to the target
  // article. Fixes the help-center "Related" section which previously
  // rendered as inert plain text.
  const handleArticlePress = useCallback(
    (targetSlug: string) => {
      router.push(`/settings/help/${targetSlug}`);
    },
    [router],
  );

  useLayoutEffect(() => {
    if (meta?.title) {
      navigation.setOptions({ title: meta.title });
    }
  }, [navigation, meta?.title]);

  if (!meta || !body) {
    return (
      <ScreenContainer safe padTop={false}>
        <Text className="text-sm text-muted-foreground p-4">
          Article not found.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer safe padTop={false}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-foreground mb-2">
          {meta.title}
        </Text>
        {meta.summary.length > 0 && (
          <Text className="text-sm text-muted-foreground leading-5 mb-5">
            {meta.summary}
          </Text>
        )}
        <SimpleMarkdown body={body} onArticlePress={handleArticlePress} />
      </ScrollView>
    </ScreenContainer>
  );
}
