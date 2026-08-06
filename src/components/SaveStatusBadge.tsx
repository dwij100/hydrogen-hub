import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { Check, CloudOff, Loader2 } from 'lucide-react';

export function SaveStatusBadge() {
  const { saveStatus, saveError, activeProjectId } = useHydrogenProject();

  if (!activeProjectId || saveStatus === 'idle') return null;

  if (saveStatus === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }

  if (saveStatus === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Check className="h-3.5 w-3.5 text-primary" /> Saved
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-destructive" aria-live="polite">
      <CloudOff className="h-3.5 w-3.5" /> {saveError ? `Save failed: ${saveError}` : 'Save failed'}
    </span>
  );
}
