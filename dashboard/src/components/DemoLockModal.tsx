import { useEffect, useState } from "react";
import { DEMO_MODE, REPO_URL } from "../lib/api";

const CLONE_CMD = `git clone ${REPO_URL}
cd production-monitoring
cp .env.example .env
docker compose up --build`;

// Thin strip under the nav so it's obvious up front that writes are disabled,
// before anyone clicks a save button. Rendered only in the demo build.
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="demo-banner">
      <span className="demo-banner-dot" aria-hidden />
      Read-only demo — live data is real, but editing is disabled.{" "}
      <a href={REPO_URL} target="_blank" rel="noreferrer">
        Run it locally
      </a>{" "}
      to try the write features.
    </div>
  );
}

// Listens for the "demo-locked" window event fired by lib/api.ts whenever a
// write is attempted (client-side in demo mode, or on a 403 READ_ONLY_DEMO from
// the backend) and explains how to get the full thing.
export function DemoLockModal() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!DEMO_MODE) return;
    const onLocked = () => {
      setCopied(false);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("demo-locked", onLocked);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("demo-locked", onLocked);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!open) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(CLONE_CMD);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="demo-modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="demo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="demo-modal-title">Run it locally to change data</h2>
        <p>
          This is a public, read-only deployment. Every screen is live off real
          telemetry, but anything that writes to the backend — registering
          machines, editing ERP master data, retuning simulators, importing jobs
          — is disabled here.
        </p>
        <p>Clone the repository and bring the full stack up with Docker:</p>
        <pre className="demo-modal-code">{CLONE_CMD}</pre>
        <div className="demo-modal-actions">
          <button type="button" onClick={copy}>
            {copied ? "Copied ✓" : "Copy commands"}
          </button>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Open repository →
          </a>
          <button type="button" className="demo-modal-dismiss" onClick={() => setOpen(false)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
