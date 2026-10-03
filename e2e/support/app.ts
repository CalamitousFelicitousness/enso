import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { finishedJob, type Job } from "./backend";

/** 528x960, a face in front of a neon sign: a detailer finds the face, and
 * neither side is a multiple of 32. */
export const PORTRAIT = fileURLToPath(new URL("../fixtures/portrait.jpg", import.meta.url));

export type SubTab = "Prompts" | "Sampler" | "Refine" | "Detail" | "Color";

/** Drives the Images view the way a user does. Every test starts from an
 * empty browser profile, so the app is in its first-run state. */
export class Enso {
  readonly page: Page;
  readonly leftPanel: Locator;
  readonly canvas: Locator;

  constructor(page: Page) {
    this.page = page;
    this.leftPanel = page.getByRole("complementary").first();
    this.canvas = page.getByRole("main");
  }

  async open(): Promise<void> {
    await this.page.goto("");
    await this.page.getByRole("button", { name: "Skip" }).click();
    // Focus mode centres the Output frame and leaves the Input frame under the Left Panel
    await this.canvas.getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(this.canvas.getByText(/^Input/)).toBeVisible();
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

  /** Turn an enableable section of the open tab on. */
  async enable(section: string): Promise<void> {
    const toggle = this.leftPanel.getByRole("switch", { name: section, exact: true });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }

  /** Switch Input 1 to Reference and give it the files, one reference each. */
  async addReferences(...files: string[]): Promise<void> {
    await this.canvas.getByRole("button", { name: "Expand settings" }).nth(1).click();
    await this.canvas.getByRole("button", { name: "Reference", exact: true }).click();
    for (const file of files) {
      const chooser = this.page.waitForEvent("filechooser");
      await this.canvas.getByRole("button", { name: "Add reference image" }).click();
      await (await chooser).setFiles(file);
    }
    await expect(this.canvas.getByRole("button", { name: "Remove reference" })).toHaveCount(
      files.length,
    );
  }

  /** The size the Output frame's header shows, as WxH. */
  async outputFrameSize(): Promise<string> {
    const label = this.canvas.getByText(/^\d+×\d+$/).first();
    return (await label.innerText()).replace("×", "x");
  }

  /** Click Generate and wait for the job to leave the queue. */
  async generate(): Promise<Job> {
    // Uploads and the request build run first, on a cold browser cache
    const submitted = this.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/sdapi/v2/jobs",
      { timeout: 120_000 },
    );
    await this.leftPanel.getByRole("button", { name: "Generate", exact: true }).click();
    const response = await submitted;
    expect(response.status(), "POST /sdapi/v2/jobs").toBe(202);
    const { id } = (await response.json()) as { id: string };
    return finishedJob(this.page.request, id);
  }

  /** Text of the toasts on screen. */
  async toasts(): Promise<string[]> {
    return this.page.locator("[data-sonner-toast]").allInnerTexts();
  }
}
