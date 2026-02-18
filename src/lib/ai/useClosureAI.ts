"use client";

import { useCallback, useMemo, useState } from "react";
import type { Patch, Section } from "@/lib/ai/closure-ai";
import { aiGenerateClosureSection, aiSuggestClosureSection } from "@/lib/ai/closure-ai";

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function useClosureAI(args: {
  doc: any;
  meta: any;

  // “virtual section” plumbing
  getSectionByKey: (key: string) => Section;
  applySectionReplace: (key: string, section: Section) => void;

  onDirty: () => void;
}) {
  const { doc, meta, getSectionByKey, applySectionReplace, onDirty } = args;

  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string>("");

  // Suggestions drawer state (optional UI)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState<string>("AI Suggestions");
  const [drawerPatch, setDrawerPatch] = useState<Patch | null>(null);
  const [drawerKey, setDrawerKey] = useState<string>("");

  const context = useMemo(() => {
    // keep it lightweight, but useful
    return {
      project: doc?.project,
      health: doc?.health,
      hasDeliverables: !!doc?.deliverables,
      hasFinancials: !!doc?.financial_closeout,
      hasLessons: !!doc?.lessons,
      hasHandover: !!doc?.handover,
      hasSignoff: !!doc?.signoff,
    };
  }, [doc]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerPatch(null);
    setDrawerKey("");
    setDrawerTitle("AI Suggestions");
  }, []);

  const applySuggestion = useCallback(
    (section: Section) => {
      if (!drawerKey) return;
      onDirty();
      applySectionReplace(drawerKey, section);
      closeDrawer();
    },
    [applySectionReplace, closeDrawer, drawerKey, onDirty]
  );

  const improveSection = useCallback(
    async (key: string) => {
      setAiError("");
      setAiLoadingKey(key);

      try {
        const currentSection = getSectionByKey(key);

        const patch = await aiSuggestClosureSection({
          key,
          meta,
          currentSection,
          context,
          prompt: "",
        });

        if (patch.kind === "suggestions") {
          setDrawerKey(key);
          setDrawerTitle(`Improve: ${s(currentSection?.title) || key}`);
          setDrawerPatch(patch);
          setDrawerOpen(true);
        } else if (patch.kind === "replace_section") {
          onDirty();
          applySectionReplace(key, patch.section);
        } else {
          throw new Error("Unexpected AI response");
        }
      } catch (e: any) {
        setAiError(e?.message || "AI failed");
      } finally {
        setAiLoadingKey(null);
      }
    },
    [applySectionReplace, context, getSectionByKey, meta, onDirty]
  );

  const regenerateSection = useCallback(
    async (key: string, prompt?: string) => {
      setAiError("");
      setAiLoadingKey(key);

      try {
        const currentSection = getSectionByKey(key);

        const patch = await aiGenerateClosureSection({
          key,
          meta,
          currentSection,
          context,
          prompt: prompt || "",
        });

        if (patch.kind === "replace_section") {
          onDirty();
          applySectionReplace(key, patch.section);
        } else {
          throw new Error("Unexpected AI response");
        }
      } catch (e: any) {
        setAiError(e?.message || "AI failed");
      } finally {
        setAiLoadingKey(null);
      }
    },
    [applySectionReplace, context, getSectionByKey, meta, onDirty]
  );

  return {
    aiLoadingKey,
    aiError,

    drawerOpen,
    drawerTitle,
    drawerPatch,
    closeDrawer,
    applySuggestion,

    improveSection,
    regenerateSection,
  };
}
