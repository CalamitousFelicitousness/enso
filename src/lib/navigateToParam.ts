import { useUiStore } from "@/stores/uiStore";
import type { ImagesSubTab, NavView, RightTab } from "@/lib/constants";

export interface NavigateTarget {
  view?: NavView;
  tab?: ImagesSubTab;
  rightTab?: RightTab;
  /** KeepAlive panel id to scope the param lookup to when the target is a
   * view without a sub-tab (the Video panel's sections). */
  panel?: string;
  section?: string;
  param?: string;
}

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
  if (target.rightTab) {
    store.openRightTab(target.rightTab);
    return;
  }

  // 2. Ensure the left panel is on screen. AppShell unmounts it while either
  // flag is set, so a collapsed view leaves nothing to scope the lookup to.
  if (store.leftPanelCollapsed) store.toggleLeftPanel();
  if (store.viewCollapsed) store.toggleViewCollapsed();

  // 3. Switch view/tab
  if (target.view) store.setNavView(target.view);
  if (target.tab) {
    store.setNavView("images");
    store.setImagesSubTab(target.tab);
  }

  // 4. If no param specified (tab-only navigation), we're done
  if (!target.param) return;

  // Scope the lookup to the target panel. Hidden panels stay mounted, so the
  // same data-param can exist in several at once. Panel ids are namespaced by
  // their host, so this resolves to exactly one element.
  const panelId = target.tab
    ? `images-${target.tab}`
    : target.panel && target.view
      ? `${target.view}-${target.panel}`
      : undefined;
  const scope = panelId ? await waitForElement(`[data-panel-id="${panelId}"]`) : document.body;
  if (!scope) {
    if (import.meta.env.DEV) console.warn(`[navigateToParam] no panel "${panelId}"`);
    return;
  }

  // 5. Expand section if specified
  if (target.section) {
    // 500ms covers a lazily mounted panel plus a lazily mounted section.
    const section = await waitForElement(`[data-section="${target.section}"]`, 500, scope);
    if (!section && import.meta.env.DEV) {
      console.warn(`[navigateToParam] no section "${target.section}" in "${panelId}"`);
    }
    document.dispatchEvent(
      new CustomEvent("param-section-expand", { detail: { section: target.section } }),
    );
  }

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
