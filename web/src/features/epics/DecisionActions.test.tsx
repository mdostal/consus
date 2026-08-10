import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionActions } from "./DecisionActions";
import * as epicsApi from "../../api/epics";

describe("DecisionActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts approval and reports the updated status", async () => {
    vi.spyOn(epicsApi, "approveEpic").mockResolvedValue({ ok: true, status: "todo", comment_id: "c1" });
    const onApproved = vi.fn();

    render(<DecisionActions epicId="m1" onApproved={onApproved} status="blocked" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(epicsApi.approveEpic).toHaveBeenCalledWith("m1"));
    expect(onApproved).toHaveBeenCalledWith("todo");
    expect(screen.getByRole("status")).toHaveTextContent("Approved.");
  });
});
