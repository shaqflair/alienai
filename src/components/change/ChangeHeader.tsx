// src/components/change/ChangeHeader.tsx
"use client";

import React from "react";

export default function ChangeHeader({
  title,
  subtitle,
  kicker,
  backHref,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  backHref?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <header className="crHeader">
      <div className="crHeaderInner">
        <div className="crHeaderLeft">
          <div className="crTitleRow">
            <div className="crLogoDot" title="Aliena">
              A
            </div>

            <div className="crTitleStack">
              {kicker ? <div className="crHeaderKicker">{kicker}</div> : null}
              <h1 className="crH1">{title}</h1>
              {subtitle ? <div className="crSub">{subtitle}</div> : null}
            </div>
          </div>
        </div>

        <div className="crHeaderRight">
          {rightSlot ? <div className="crHeaderSlot">{rightSlot}</div> : null}

          {backHref ? (
            <a className="crHeaderLink" href={backHref}>
              ← Back
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
