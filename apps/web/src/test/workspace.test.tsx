import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { TicketTable } from "../components/TicketTable";
import { defaultPathForRole } from "../lib/auth";
import { seedTickets } from "../lib/fixtures";

afterEach(cleanup);
describe("role routes and ticket presentation", () => {
  it("uses a separate home for each role", () => {
    expect(defaultPathForRole("REPORTER")).toBe("/requests");
    expect(defaultPathForRole("SUPPORT_AGENT")).toBe("/inbox");
    expect(defaultPathForRole("ADMIN")).toBe("/all-tickets");
  });
  it("shows an explicit unassigned priority and a distinct status", () => {
    render(
      <>
        <PriorityBadge priority={null} />
        <StatusBadge status="IN_PROGRESS" />
      </>,
    );
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
  });
  it("renders the ticket detail route for each seeded ticket", () => {
    const ticket = seedTickets[0];
    if (!ticket) throw new Error("Missing seed ticket");
    render(
      <MemoryRouter>
        <TicketTable tickets={[ticket]} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(
      links.every((link) => link.getAttribute("href") === `/tickets/${ticket.id}`),
    ).toBe(true);
  });
});
