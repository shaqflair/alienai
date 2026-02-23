"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Patch, Section } from "@/lib/ai/charter-ai";
import { aiSuggestSection, aiGenerateSection, aiValidateCharter } from "@/lib/ai/charter-ai";

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function useCharterAI(args: {
  meta: any;
  sections: any[];
  getSectionByKey: (key: string) => any;
  applySectionReplace: (key: string, section: any) => void;
  onDirty: () => void;
}) {
  const { meta, sections, getSectionByKey, applySectionReplace, onDirty } = args;

  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string>("");

  // Suggestions drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState<string>("AI Suggestions");
  const [drawerPatch, setDrawerPatch] = useState<Patch | null>(null);
  const [drawerKey, setDrawerKey] = useState<string>("");

  const context = useMemo(() => {
    // Keep context lightweight (no massive JSON)
    return {
      meta,
      sectionKeys: (sections || []).map((x: any) => s(x?.key)).filter(Boolean),
    };
  }, [meta, sections]);

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

  // This is what your section button calls:
  // Step 1 UI only -> Step 2 wire -> Step 3 replace only section
  const improveSection = useCallback(
    async (key: string) => {
      setAiError("");
      setAiLoadingKey(key);

      try {
        const currentSection = getSectionByKey(key);
        const patch = await aiSuggestSection({
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
          // if provider returns direct replace, apply it
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

  const generateSection = useCallback(
    async (key: string, prompt?: string) => {
      setAiError("");
      setAiLoadingKey(key);

      try {
        const currentSection = getSectionByKey(key);
        const patch = await aiGenerateSection({ key, meta, currentSection, context, prompt: prompt || "" });

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

  const validate = useCallback(
    async (doc: any) => {
      setAiError("");
      try {
        const patch = await aiValidateCharter(doc);
        return patch;
      } catch (e: any) {
        setAiError(e?.message || "Validate failed");
        return null;
      }
    },
    []
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
    generateSection,
    validate,
  };
}