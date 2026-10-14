import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Locator, type Page, type Response } from "@playwright/test";
import { finishedJob, type Job } from "./backend";

/** 528x960, a face in front of a neon sign: a detailer finds the face, and
 * neither side is a multiple of 32. */
export const PORTRAIT = fileURLToPath(new URL("../fixtures/portrait.jpg", import.meta.url));

export type SubTab = "Prompts" | "Sampler" | "Refine" | "Detail" | "Color" | "Input";

export type View = "Images" | "Video" | "Process" | "Caption" | "Gallery";

/** The app in a second browser with an empty profile, as someone else would
 * open it. Close it with `app.page.context().close()`. */
export async function openContext(browser: Browser): Promise<Enso> {
  const context = await browser.newContext();
  const app = new Enso(await context.newPage());
  await app.open();
  return app;
}

/** Drives the app the way a user does. Every test starts from an empty
 * browser profile, so the app is in its first-run state. */
export class Enso {
  readonly page: Page;
  readonly leftPanel: Locator;
  readonly canvas: Locator;
  readonly rightPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.leftPanel = page.getByRole("complementary").first();
    this.canvas = page.getByRole("main");
    this.rightPanel = page.getByRole("complementary").nth(1);
  }

  async open(): Promise<void> {
    await this.page.goto("");
    await this.page.getByRole("button", { name: "Skip", exact: true }).click();
    // Focus mode centres the Output frame and leaves the Input frame under the Left Panel
    await this.canvas.getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(this.canvas.getByText(/^Input/)).toBeVisible();
  }

  /** Load the page again in the same profile, in whichever view it was. The
   * tutorial shows only until it is closed once, so it is skipped only when
   * it shows. */
  async reopen(): Promise<void> {
    await this.page.reload();
    await expect(
      this.page.getByRole("navigation").getByRole("button", { pressed: true }).first(),
    ).toBeVisible();
    const skip = this.page.getByRole("button", { name: "Skip", exact: true });
    if (await skip.isVisible()) await skip.click();
  }

  /** Switch the view by its Left Rail button; a click on the open view collapses its panel. */
  async view(name: View): Promise<void> {
    const button = this.page.getByRole("navigation").getByRole("button", { name, exact: true });
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }

  async openTab(tab: SubTab): Promise<void> {
    const radio = this.page.getByRole("radio", { name: tab, exact: true });
    // Clicking the active tab collapses the Left Panel
    if (!(await radio.isChecked())) await radio.click();
  }

  async setPrompt(text: string): Promise<void> {
    await this.openTab("Prompts");
    await this.leftPanel.locator(".cm-content").first().fill(text);
  }

  /** A slider of the open tab, by its label. */
  slider(label: string): Locator {
    return this.leftPanel
      .locator(`[role=slider][data-param="${label.toLowerCase()}"]`)
      .filter({ visible: true })
      .first();
  }

  async setSlider(label: string, value: number): Promise<void> {
    const slider = this.slider(label);
    const input = slider.locator("input[type=number]");
    // The inline editor closes when its tab re-renders under it, so the whole edit retries
    await expect(async () => {
      await slider.locator("[data-value-span]").click({ timeout: 5000 });
      await input.fill(String(value), { timeout: 5000 });
      await input.press("Enter", { timeout: 5000 });
      await expect(slider).toHaveAttribute("aria-valuenow", String(value), { timeout: 5000 });
    }).toPass({ timeout: 60_000 });
  }

  async setSize(width: number, height: number): Promise<void> {
    await this.openTab("Prompts");
    await this.setSlider("Width", width);
    await this.setSlider("Height", height);
  }

  async setSteps(steps: number): Promise<void> {
    await this.openTab("Sampler");
    await this.setSlider("Steps", steps);
  }

  /** Pick a sampler by its name in the list. */
  async setSampler(from: string, to: string): Promise<void> {
    await this.openTab("Sampler");
    await this.pick(from, to);
  }

  /** Pick an option of a searchable list of the open tab, opened by the
   * option it shows now. */
  async pick(from: string, to: string): Promise<void> {
    const picked = this.leftPanel.getByRole("button", { name: to, exact: true });
    const search = this.page.getByPlaceholder("Search...");
    await expect(async () => {
      if (await picked.isVisible()) return;
      if (!(await search.isVisible())) {
        await this.leftPanel
          .getByRole("button", { name: from, exact: true })
          .click({ timeout: 5000 });
      }
      // The list filters as you type; Enter takes the top match
      await search.fill(to, { timeout: 5000 });
      await expect(this.page.getByRole("option", { name: to, exact: true })).toBeVisible({
        timeout: 5000,
      });
      await this.page.keyboard.press("Enter");
      await expect(picked).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60_000 });
  }

  /** Turn a switch of the Left Panel on or off: an enableable section's or a toggle's. */
  async setSwitch(name: string, on: boolean): Promise<void> {
    const toggle = this.leftPanel.getByRole("switch", { name, exact: true });
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
  }

  /** Turn an enableable section of the open tab on. */
  async enable(section: string): Promise<void> {
    await this.setSwitch(section, true);
  }

  /** Expand a collapsible section of the Left Panel by its title. */
  async expand(section: string): Promise<void> {
    // The section's enable toggle carries its title too
    const chevron = this.leftPanel
      .getByRole("button", { name: section, exact: true })
      .and(this.leftPanel.locator("[aria-expanded]"));
    if ((await chevron.getAttribute("aria-expanded")) !== "true") {
      // The title's description covers the chevron while the title has the pointer or focus
      await chevron.focus();
      await chevron.hover({ force: true });
      await chevron.click();
    }
    await expect(chevron).toHaveAttribute("aria-expanded", "true");
  }

  /** The row of a frame in the Input tab's outline. */
  outlineRow(position: number): Locator {
    return this.leftPanel.getByRole("option", { name: new RegExp(`^Input ${position},`) });
  }

  /** Switch Input 1 to Reference and give it the files, one reference each,
   * through the Input tab. */
  async addReferences(...files: string[]): Promise<void> {
    await this.openTab("Input");
    await this.outlineRow(1).click();
    await this.leftPanel.getByRole("button", { name: "Reference", exact: true }).click();
    for (const file of files) {
      const chooser = this.page.waitForEvent("filechooser");
      await this.leftPanel.getByRole("button", { name: "Add picture" }).click();
      await (await chooser).setFiles(file);
    }
    for (const name of new Set(files.map((file) => basename(file)))) {
      const count = files.filter((file) => basename(file) === name).length;
      await expect(this.leftPanel.getByRole("button", { name: `Remove ${name}` })).toHaveCount(
        count,
      );
    }
  }

  /** Add a ControlNet frame through the Input tab and give it the file. */
  async addControlFrame(file: string): Promise<void> {
    await this.openTab("Input");
    await this.leftPanel.getByRole("button", { name: "Add Input" }).click();
    // A ControlNet frame's type picker reads ControlNet too
    await this.page
      .getByRole("dialog")
      .getByRole("button", { name: "ControlNet", exact: true })
      .click();
    const chooser = this.page.waitForEvent("filechooser");
    await this.leftPanel.getByRole("button", { name: "Add Image" }).click();
    await (await chooser).setFiles(file);
  }

  /** Choose an item of a frame's More menu, in its dock on the canvas. */
  async frameMenu(position: number, item: string): Promise<void> {
    await this.canvas.getByRole("button", { name: `More actions for Input ${position}` }).click();
    await this.page.getByRole("menuitem", { name: item }).click();
  }

  /** Save a frame to the library from its More menu; the saved entry's id. */
  async saveFrame(position: number): Promise<string> {
    // the save uploads first, on a cold page
    const posted = this.page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/sdapi/v2/library",
      { timeout: 120_000 },
    );
    await this.frameMenu(position, "Save to library");
    const response = await posted;
    expect(response.ok(), `POST /sdapi/v2/library answered ${response.status()}`).toBe(true);
    return ((await response.json()) as { entry: { id: string } }).entry.id;
  }

  /** The size the Output frame's header shows, as WxH. */
  async outputFrameSize(): Promise<string> {
    const output = this.canvas.getByRole("group", { name: "Output" });
    const label = output.getByText(/^\d+×\d+$/).first();
    return (await label.innerText()).replace("×", "x");
  }

  /** Give the Process view its pictures. */
  async processFiles(...files: string[]): Promise<void> {
    await this.view("Process");
    await this.leftPanel.getByRole("radio", { name: "Batch", exact: true }).click();
    // The first file input in the page is the Top Bar's interrogate tool
    await this.canvas
      .locator('label:has-text("Drop images here") input[type=file]')
      .setInputFiles(files);
  }

  /** Turn a Process section on and expand it. */
  async processSection(title: string): Promise<void> {
    await this.enable(title);
    await this.expand(title);
  }

  /** Run the Process view and wait for its job to leave the queue. */
  async process(): Promise<Job> {
    return this.submit(() =>
      this.leftPanel.getByRole("button", { name: "Process", exact: true }).click(),
    );
  }

  /** Open a Gallery folder by its label and select a file in it by name. */
  async galleryFile(folder: string, name: string): Promise<void> {
    await this.view("Gallery");
    await this.leftPanel.getByRole("button", { name: folder, exact: true }).click();
    await this.page.getByPlaceholder("Search files...").fill(name);
    // A card clicked while the filtered grid settles stays unselected
    await expect(async () => {
      await this.canvas.getByRole("button", { name, exact: true }).click({ timeout: 5000 });
      await expect(this.canvas.getByRole("img", { name, exact: true })).toBeVisible({
        timeout: 5000,
      });
    }).toPass({ timeout: 60_000 });
  }

  /** Open the Gallery's Trash folder; a click on the open folder would leave it. */
  async galleryTrash(): Promise<void> {
    await this.view("Gallery");
    const trash = this.leftPanel.getByRole("button", { name: "Trash", exact: true });
    if ((await trash.getAttribute("aria-current")) !== "true") await trash.click();
    await expect(trash).toHaveAttribute("aria-current", "true");
  }

  /** Bring the selected files back from the Trash folder, each to its own folder. */
  async restoreFiles(): Promise<void> {
    await this.canvas.getByRole("button", { name: "Restore", exact: true }).first().click();
  }

  /** Do what posts a job with its record, then wait for the job to leave the queue. */
  async submit(action: () => Promise<void>): Promise<Job> {
    // Uploads and the request build run first, on a cold browser cache
    const submitted = this.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/sdapi/v2/submit",
      { timeout: 120_000 },
    );
    await action();
    const response: Response = await submitted;
    expect(response.ok(), `POST /sdapi/v2/submit answered ${response.status()}`).toBe(true);
    const { id } = (await response.json()) as { id: string };
    return finishedJob(this.page.request, id);
  }

  /** Click Generate and wait for the job to leave the queue. */
  async generate(): Promise<Job> {
    return this.submit(() =>
      this.leftPanel.getByRole("button", { name: "Generate", exact: true }).click(),
    );
  }

  /** Text of the toasts on screen. */
  async toasts(): Promise<string[]> {
    return this.page.locator("[data-sonner-toast]").allInnerTexts();
  }

  /** A result's thumbnail on the strip, newest first. */
  resultThumb(index = 0): Locator {
    return this.leftPanel.getByRole("button", { name: "Result", exact: true }).nth(index);
  }

  /** Choose an item of a result's menu. The menu is opened by its event: a
   * right button released over a menu that opened above the pointer would
   * choose the item under it. */
  async resultMenu(item: string, index = 0): Promise<void> {
    await this.resultThumb(index).dispatchEvent("contextmenu");
    await this.page.getByRole("menuitem", { name: item, exact: true }).click();
  }

  /** Run a result's job again and wait for the new job to leave the queue. */
  async runAgain(index = 0): Promise<Job> {
    return this.submit(() => this.resultMenu("Run again", index));
  }

  /** Run the newest History card's job again and wait for the new job. */
  async runAgainFromHistory(): Promise<Job> {
    await this.openRightTab("History");
    const slot = this.rightPanel.getByRole("button", { name: "Run again", exact: true }).first();
    // the slot reads its job's record before it acts
    await expect(slot).not.toHaveAttribute("aria-disabled", "true");
    return this.submit(() => slot.click());
  }

  /** Open a Right Panel tab by its rail button; a click on the open tab would close it. */
  async openRightTab(name: string): Promise<void> {
    const tab = this.page.getByRole("button", { name, exact: true });
    if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
  }
}
