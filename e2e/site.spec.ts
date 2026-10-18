import { expect, test } from "@playwright/test";

test.describe("public site", () => {
  test("home introduces the studio", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Your event/ })).toBeVisible();
    await expect(page.getByTestId("button-hero-build")).toBeVisible();
  });

  test("weddings page loads", async ({ page }) => {
    await page.goto("/weddings");
    await expect(page.getByRole("heading", { name: /Weddings/ })).toBeVisible();
    await expect(page.getByTestId("button-wedding-build")).toBeVisible();
  });

  test("contact page loads", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: /Let.s talk about/ })).toBeVisible();
    await expect(page.getByTestId("button-contact-build")).toBeVisible();
  });

  test("unknown routes show the site not-found page", async ({ page }) => {
    await page.goto("/not-a-real-room");
    await expect(page.getByRole("heading", { name: /That room isn.t here/ })).toBeVisible();
    await page.getByTestId("link-not-found-home").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /Your event/ })).toBeVisible();
  });
});

test.describe("office and portals", () => {
  test("admin opens the office or the sign-in form", async ({ page }) => {
    await page.goto("/admin");
    const login = page.getByRole("heading", { name: "Admin" });
    const office = page.getByRole("navigation", { name: "Office" });
    await expect(login.or(office)).toBeVisible();
    if (await login.isVisible()) {
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      return;
    }
    await office.getByRole("link", { name: "Events", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/planner/);
  });

  test("client planner opens an event or rejects a bad code", async ({ page }) => {
    await page.goto("/planner");
    const login = page.getByRole("heading", { name: "Client planner" });
    const sections = page.getByRole("navigation", { name: "Planner sections" });
    await expect(login.or(sections)).toBeVisible();
    if (await login.isVisible()) {
      await page.getByLabel("Event code").fill("MB-NOPE");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert")).toContainText(/doesn.t match|don.t match|Enter your event code/);
      return;
    }
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await sections.getByRole("button", { name: "Music", exact: true }).click();
    await expect(sections.getByRole("button", { name: "Music", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("guest requests open a form or reject a bad code", async ({ page }) => {
    await page.goto("/planner/guest");
    const code = page.getByLabel("Guest code");
    const song = page.getByLabel("Song");
    await expect(code.or(song)).toBeVisible();
    if (await code.isVisible()) {
      await code.fill("G-NOPE");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("alert")).toContainText(/doesn.t match|don.t match|Enter the guest code/);
      return;
    }
    await expect(page.getByRole("heading", { name: "Request a song" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
  });
});
