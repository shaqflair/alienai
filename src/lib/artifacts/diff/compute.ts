// src/lib/artifacts/diff/compute.ts
import type { ArtifactDiff, ArtifactDiffItem } from "./types";

function isObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function joinPath(base: string, key: string) {
  if (!base) return key;
  // key might be "0" for arrays — handled elsewhere
  return `${base}.${key}`;
}

function diffAny(before: any, after: any, path = "", out: ArtifactDiffItem[] = []) {
  // identical
  if (before === after) return out;

  // null/undefined handling
  if (before === undefined && after !== undefined) {
    out.push({ path: path || "(root)", op: "add", after });
    return out;
  }
  if (before !== undefined && after === undefined) {
    out.push({ path: path || "(root)", op: "remove", before });
    return out;
  }

  // arrays
  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const p = path ? `${path}[${i}]` : `[${i}]`;
      diffAny(before[i], after[i], p, out);
    }
    return out;
  }

  // objects
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      diffAny(before[k], after[k], joinPath(path, k), out);
    }
    return out;
  }

  // primitive / different types => replace
  out.push({ path: path || "(root)", op: "replace", before, after });
  return out;
}

export function computeArtifactDiff(params: {
  artifactType?: string;
  beforeValue: any;
  afterValue: any;
}): ArtifactDiff {
  const items: ArtifactDiffItem[] = [];
  diffAny(params.beforeValue, params.afterValue, "", items);
  return { version: 1, artifact_type: params.artifactType, items };
}
