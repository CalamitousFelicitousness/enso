import { Button } from "@/components/ui/button";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { shownRows } from "@/lib/profile/rows";
import { PANEL_INTRO, PANEL_TITLE, RESET_OPEN, ROW_NAMES, rowDetail } from "@/lib/profile/text";
import { useProfileMeasure } from "@/profile/measure";
import { useResetDialogStore } from "@/stores/resetDialogStore";

/** What Enso keeps in this browser, counted each time the section shows,
 * and the way to reset it. */
export function ThisBrowserPanel() {
  const visible = useKeepAliveVisible();
  const measure = useProfileMeasure(visible);
  const openReset = useResetDialogStore((s) => s.openReset);
  return (
    <div>
      <h3 className="text-sm font-medium mb-1">{PANEL_TITLE}</h3>
      <p className="text-2xs text-muted-foreground mb-4">{PANEL_INTRO}</p>
      <dl className="space-y-3">
        {shownRows(measure).map((row) => (
          <div key={row}>
            <dt className="text-xs font-medium">{ROW_NAMES[row]}</dt>
            <dd className="text-2xs text-muted-foreground">{rowDetail(row, measure)}</dd>
          </div>
        ))}
      </dl>
      <Button
        variant="destructive-soft"
        size="sm"
        className="mt-5 h-auto min-h-8 whitespace-normal py-1.5 text-left text-xs"
        onClick={openReset}
      >
        {RESET_OPEN}
      </Button>
    </div>
  );
}
