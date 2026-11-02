// The "Save Changes?" question the New Event dialog asks when it edits a repeating event: this event or every one.

import type { UpdateScope } from "@/lib/calendar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function ScopeDialog({ open, onOpenChange, saveOn }: { open: boolean; onOpenChange: (open: boolean) => void; saveOn: (scope: UpdateScope) => (e: React.MouseEvent) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent track="save_event_scope">
        <AlertDialogHeader>
          <AlertDialogTitle>Save Changes?</AlertDialogTitle>
          <AlertDialogDescription>This event repeats. Save the changes to only this one, or to every event in the series.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="ghost" onClick={saveOn("occurrence")}>Save This Event</AlertDialogAction>
          <AlertDialogAction variant="secondary" onClick={saveOn("series")}>Save All Events</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
