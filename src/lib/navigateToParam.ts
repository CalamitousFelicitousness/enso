import { useUiStore } from "@/stores/uiStore";
import type {
  ImagesSubTab,
  NavView,
  RightSubTabTarget,
  RightTab,
  VideoSubTab,
} from "@/lib/constants";

interface ParamLocation {
  /** The section holding the param, or the path of nested sections down to it. */
  section?: string | readonly string[];
  param?: string;
}

export type NavigateTarget =
  | { rightTab: RightTab }
  | RightSubTabTarget
  | ({ view: "images"; subTab?: ImagesSubTab } & ParamLocation)
  | ({ view: "video"; subTab?: VideoSubTab } & ParamLocation)
  | ({ view: Exclude<NavView, "images" | "video"> } & ParamLocation);

function waitForElement(
  selector: string,
  timeout = 500,
  root: ParentNode = document,
): Promise<Element | null> {
  const existing = root.querySelector(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function highlight(el: Element) {
  el.removeAttribute("data-highlight");
  void (el as HTMLElement).offsetWidth;
  el.setAttribute("data-highlight", "");
  el.addEventListener("animationend", () => el.removeAttribute("data-highlight"), { once: true });
}

export async function navigateToParam(target: NavigateTarget) {
  const store = useUiStore.getState();

  // 1. Right panel tab navigation
  if ("rightTab" in target) {
    if ("subTab" in target) store.openRightSubTab(target);
    else store.openRightTab(target.rightTab);
    return;
  }

  // 2. Ensure the left panel is on screen. AppShell unmounts it while either
  // flag is set, so a collapsed view leaves nothing to scope the lookup to.
  if (store.leftPanelCollapsed) store.toggleLeftPanel();
  if (store.viewCollapsed) store.toggleViewCollapsed();

  // 3. Switch view/tab
  store.setNavView(target.view);
  if (target.view === "images" && target.subTab) store.setImagesSubTab(target.subTab);
  if (target.view === "video" && target.subTab) {
    store.setPanelSelection("videoSubTab", target.subTab);
  }

  // 4. Tab-only navigation ends here
  const sections =
    target.section === undefined
      ? []
      : typeof target.section === "string"
        ? [target.section]
        : target.section;
  if (!target.param && sections.length === 0) return;

  // Scope the lookup to the target panel. Hidden panels stay mounted, so the
  // same data-param can exist in several at once. Panel ids are namespaced by
  // their host, so this resolves to exactly one element.
  const subTab = "subTab" in target ? target.subTab : undefined;
  const panelId = subTab ? `${target.view}-${subTab}` : undefined;
  const scope = panelId ? await waitForElement(`[data-panel-id="${panelId}"]`) : document.body;
  if (!scope) {
    if (import.meta.env.DEV) console.warn(`[navigateToParam] no panel "${panelId}"`);
    return;
  }

  // 5. Expand each section, outermost first: an inner one mounts when its parent opens
  for (const name of sections) {
    // 500ms covers a lazily mounted panel plus a lazily mounted section.
    const section = await waitForElement(`[data-section="${name}"]`, 500, scope);
    if (!section && import.meta.env.DEV) {
      console.warn(`[navigateToParam] no section "${name}" in "${panelId}"`);
    }
    document.dispatchEvent(new CustomEvent("param-section-expand", { detail: { section: name } }));
  }
  if (!target.param) return;

  // 6. Wait for the param element to appear within the target panel
  const el = await waitForElement(`[data-param="${target.param}"]`, 500, scope);
  if (!el) {
    if (import.meta.env.DEV) console.warn(`[navigateToParam] no param "${target.param}"`);
    return;
  }

  // 7. Scroll into view
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  // 8. Highlight
  requestAnimationFrame(() => highlight(el));
}

/** Open the section that picks a view's color LUT. */
export function openLutSection(where: "images" | "process"): void {
  void navigateToParam(
    where === "images"
      ? { view: "images", subTab: "color", section: "lut" }
      : { view: "process", section: ["color grading", "lut"] },
  );
}
