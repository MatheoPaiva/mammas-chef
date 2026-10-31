import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";

interface EditablePlanTitleProps {
  title: string;
  onRename?: (title: string) => Promise<void>;
  className?: string;
}

const EditablePlanTitle = ({ title, onRename, className }: EditablePlanTitleProps) => {
  // Inline title-edit state. Only active when onRename is provided.
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [committingTitle, setCommittingTitle] = useState(false);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  // Suppresses the onBlur commit handler when the user explicitly cancels
  // via Escape (which itself blurs the input).
  const cancellingRef = useRef(false);

  const enterTitleEdit = () => {
    if (!onRename) return;
    setDraftTitle(title);
    setTitleError(null);
    setEditingTitle(true);
  };

  const exitTitleEdit = (restoreFocus = true) => {
    setEditingTitle(false);
    setTitleError(null);
    setCommittingTitle(false);
    if (restoreFocus) {
      // Defer to next tick so the button is rendered before we focus it.
      setTimeout(() => titleButtonRef.current?.focus(), 0);
    }
  };

  const commitTitleEdit = async () => {
    if (!onRename) return;
    const trimmed = draftTitle.trim();
    // WR-01: reject empty titles up front. On unsaved plans onRename() does not
    // persist (so renameMealPlan's empty-title rejection never runs), which would
    // otherwise let an empty title reach saveMealPlan. Mirror the sidebar guard.
    if (!trimmed || trimmed === title.trim()) {
      exitTitleEdit();
      return;
    }
    if (committingTitle) return;
    setCommittingTitle(true);
    try {
      await onRename(trimmed);
      exitTitleEdit();
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Failed to rename");
      setCommittingTitle(false);
      // Leave the input mounted so the user can correct it.
    }
  };

  if (onRename && editingTitle) {
    return (
      <div className={className}>
        <Input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitTitleEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancellingRef.current = true;
              exitTitleEdit();
            }
          }}
          onBlur={() => {
            if (cancellingRef.current) {
              cancellingRef.current = false;
              return;
            }
            void commitTitleEdit();
          }}
          disabled={committingTitle}
          aria-label="Plan title"
          className="font-heading font-bold text-3xl md:text-4xl h-auto py-1.5 px-2 rounded-lg border-border"
        />
        {titleError && (
          <p className="text-xs text-destructive mt-1.5">{titleError}</p>
        )}
      </div>
    );
  }

  if (onRename) {
    return (
      <div className={className}>
        <button
          ref={titleButtonRef}
          type="button"
          onClick={enterTitleEdit}
          aria-label="Rename plan"
          title="Click to rename"
          className="flex items-center gap-2 -mx-2 px-2 py-1 rounded-lg hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring tap-highlight-none touch-target"
        >
          <h1 className="font-heading font-bold text-3xl md:text-4xl text-foreground">
            {title}
          </h1>
          <Pencil aria-hidden className="w-5 h-5 text-muted-foreground shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <h1 className={`font-heading font-bold text-3xl md:text-4xl text-foreground truncate ${className ?? ""}`}>
      {title}
    </h1>
  );
};

export default EditablePlanTitle;
