"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ClientLockState = {
  artifactId: string;
  title: string;
  status: string;
  artifactType: string;
  projectId: string;
  organisationId: string;
  currentDraftRev: number;
  currentVersionNo: number;
  canEditByStatus: boolean;
  activeLock: {
    sessionId: string;
    artifactId: string;
    userId: string;
    editorName: string | null;
    acquiredAt: string;
    lastHeartbeatAt: string;
    expiresAt: string;
    isMine: boolean;
    isExpired: boolean;
  } | null;
  readOnlyReason: string | null;
};

type SaveDraftPayload = {
  title: string;
  content: unknown;
  summary?: string | null;
};

type Options = {
  artifactId: string;
  enabled: boolean;
  initialDraftRev: number;
};

async function readJson<T = any>(res: Response): Promise<T> {
  return res.json().catch(() => ({} as T));
}

export function useArtifactCollaboration({
  artifactId,
  enabled,
  initialDraftRev,
}: Options) {
  const [state, setState] = useState<ClientLockState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draftRev, setDraftRev] = useState<number>(initialDraftRev);
  const [loading, setLoading] = useState<boolean>(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const acquiredRef = useRef(false);

  const refreshState = useCallback(async () => {
    const res = await fetch(`/api/artifacts/${artifactId}/collaboration`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await readJson(res);
    if (data?.ok && data?.state) {
      setState(data.state);
      setDraftRev(Number(data.state.currentDraftRev || 0));
    }
    return data;
  }, [artifactId]);

  const acquire = useCallback(async () => {
    if (!enabled) return false;
    setLoading(true);
    setLockError(null);

    const res = await fetch(`/api/artifacts/${artifactId}/collaboration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "acquire" }),
      cache: "no-store",
    });

    const data = await readJson(res);
    setLoading(false);

    if (data?.ok) {
      acquiredRef.current = true;
      setState(data.artifact);
      setSessionId(data.lock?.sessionId || null);
      setDraftRev(Number(data.artifact?.currentDraftRev || initialDraftRev || 0));
      return true;
    }

    setState(data?.artifact || null);
    if (data?.reason === "locked_by_other") {
      setLockError(data?.artifact?.readOnlyReason || "Locked by another editor.");
    } else if (data?.reason === "approval_locked") {
      setLockError("This artifact is locked while under approval.");
    } else {
      setLockError("Unable to acquire edit lock.");
    }
    return false;
  }, [artifactId, enabled, initialDraftRev]);

  const refreshLock = useCallback(async () => {
    if (!sessionId) return false;

    const res = await fetch(`/api/artifacts/${artifactId}/collaboration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "refresh",
        sessionId,
      }),
      cache: "no-store",
    });

    const data = await readJson(res);
    if (data?.ok) {
      setState((prev) =>
        prev
          ? {
              ...prev,
              activeLock: data.lock,
              readOnlyReason: null,
            }
          : prev
      );
      return true;
    }

    await refreshState();
    setSessionId(null);
    acquiredRef.current = false;
    return false;
  }, [artifactId, sessionId, refreshState]);

  const releaseLock = useCallback(
    async (reason = "released") => {
      if (!sessionId) return true;

      try {
        await fetch(`/api/artifacts/${artifactId}/collaboration`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "release",
            sessionId,
            releaseReason: reason,
          }),
          keepalive: true,
        });
      } catch {
        // ignore
      }

      setSessionId(null);
      acquiredRef.current = false;
      return true;
    },
    [artifactId, sessionId]
  );

  const saveDraft = useCallback(
    async ({ title, content, summary = null }: SaveDraftPayload) => {
      if (!sessionId) {
        return {
          ok: false,
          reason: "not_owner",
          message: "No edit lock is held.",
        };
      }

      const res = await fetch(`/api/artifacts/${artifactId}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          clientDraftRev: draftRev,
          title,
          content,
          autosave: true,
          summary,
        }),
      });

      const data = await readJson(res);

      if (data?.ok) {
        setDraftRev(Number(data.currentDraftRev || draftRev + 1));
        setState((prev) =>
          prev
            ? {
                ...prev,
                title,
                currentDraftRev: Number(data.currentDraftRev || prev.currentDraftRev + 1),
              }
            : prev
        );
      } else if (data?.reason === "stale_revision" || data?.reason === "not_owner") {
        await refreshState();
      }

      return data;
    },
    [artifactId, sessionId, draftRev, refreshState]
  );

  useEffect(() => {
    if (!enabled) {
      refreshState();
      return;
    }

    acquire();

    return () => {
      releaseLock("unmount");
    };
  }, [enabled, acquire, releaseLock, refreshState]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    heartbeatRef.current = window.setInterval(() => {
      refreshLock();
    }, 45_000);

    return () => {
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [enabled, sessionId, refreshLock]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (!sessionId) return;
      navigator.sendBeacon?.(
        `/api/artifacts/${artifactId}/collaboration`,
        new Blob(
          [
            JSON.stringify({
              action: "release",
              sessionId,
              releaseReason: "page_unload",
            }),
          ],
          { type: "application/json" }
        )
      );
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [artifactId, sessionId]);

  const isReadOnly = useMemo(() => {
    if (!state) return !enabled;
    if (!state.canEditByStatus) return true;
    if (state.activeLock && !state.activeLock.isMine) return true;
    return false;
  }, [state, enabled]);

  return {
    state,
    sessionId,
    draftRev,
    loading,
    lockError,
    isReadOnly,
    acquire,
    refreshState,
    refreshLock,
    releaseLock,
    saveDraft,
    setDraftRev,
  };
}