import { AdministrationApiError } from "./administration-client";

// Shared truthful async-state rendering for the approver journey: 401 routes
// to the sign-in redirect, 403 is an honest "insufficient role" message, and
// network/5xx failures offer a retry. No state ever fabricates data.

export interface ClassifiedError {
  title: string;
  detail: string;
  retryable: boolean;
  unauthorized: boolean;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof AdministrationApiError) {
    if (error.status === 401) {
      return {
        title: "Session expired",
        detail: "The administration API rejected the session token (HTTP 401). Redirecting to the approved identity authority for a fresh sign-in.",
        retryable: false,
        unauthorized: true,
      };
    }
    if (error.status === 403) {
      return {
        title: "Insufficient role for this action",
        detail: `The administration API denied the call (HTTP 403). An approver role (${"platform-admin"} or ${"nimasa-officer"}) within this tenant is required; the recorded identity does not hold one. ${error.message}`,
        retryable: false,
        unauthorized: false,
      };
    }
    if (error.kind === "network") {
      return {
        title: "Administration API unreachable",
        detail: error.message,
        retryable: true,
        unauthorized: false,
      };
    }
    return {
      title: "Administration API error",
      detail: error.message,
      retryable: true,
      unauthorized: false,
    };
  }
  return {
    title: "Unexpected portal error",
    detail: error instanceof Error ? error.message : "The action failed without a diagnostic.",
    retryable: true,
    unauthorized: false,
  };
}

interface ErrorNoticeProperties {
  error: ClassifiedError;
  onRetry?: () => void;
}

export function ErrorNotice({ error, onRetry }: ErrorNoticeProperties) {
  return (
    <section className="empty-state empty-state--alert" role="alert">
      <p className="eyebrow">Observed failure</p>
      <h2>{error.title}</h2>
      <p>{error.detail}</p>
      {error.retryable && onRetry !== undefined && (
        <button className="button button--outline" onClick={onRetry}>Retry the authorised call</button>
      )}
    </section>
  );
}

export function LoadingNotice({ label }: { label: string }) {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="eyebrow">Authorised call in flight</p>
      <h2>{label}</h2>
      <p>The portal is waiting for the central administration API. No cached or substitute data is shown.</p>
    </section>
  );
}
