// What happens next for a purchase order, in plain words (the PO list's status column).
/** What happens next for one PO, in plain words. */
export function poNextStep(status: string): string {
  switch (status) {
    case "ready":
      return "Next: send it to the supplier";
    case "pending_approval":
      return "Next: Owner approves or rejects";
    case "approved":
      return "Owner approved · next: send it";
    case "sent":
      return "Sent to the supplier (simulated) · arriving as incoming stock";
    case "rejected":
      return "Rejected by the Owner · not sent";
    case "open":
      return "Earlier order, still in transit";
    case "received":
      return "Earlier order, received";
    default:
      return "Earlier order, cancelled";
  }
}
