// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { computePricing } from "@/lib/pricing/compute";
import { PaymentPanel } from "./PaymentPanel";

/**
 * The payment page now mints the DEPOSIT intent during its own render and hands
 * the client secret to this panel, so the card form mounts on first paint instead
 * of after a hydrate-then-round-trip. This suite covers the seam that creates,
 * because both ways of getting it wrong are invisible in a happy-path click-through:
 *
 *  - re-requesting what the server already provided just wastes the optimisation
 *  - NOT requesting on a mode switch means a student cannot pay in full at all
 *
 * The second is a revenue bug, and the switch is exactly what the seed must not
 * suppress: flipping to pay-in-full CANCELS the deposit intent server-side, so the
 * seeded secret is dead from that moment.
 */

const h = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
  reconcilePayment: vi.fn(),
  push: vi.fn(),
  elementsProps: [] as unknown[],
}));

vi.mock("@/app/(booking)/book/actions", () => ({
  createPaymentIntent: h.createPaymentIntent,
  reconcilePayment: h.reconcilePayment,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => Promise.resolve(null) }));
// Record what Elements is mounted with: the clientSecret it receives is the whole
// point of the change, and it is not otherwise observable from the DOM.
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, options }: { children: React.ReactNode; options: unknown }) => {
    h.elementsProps.push(options);
    return <div data-testid="stripe-elements">{children}</div>;
  },
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => null,
  useElements: () => null,
}));

const pricing = computePricing({
  basePrice: 43900,
  depositAmount: 15000,
  downpaymentAmount: 5000,
  damageDepositAmount: 10000,
  extras: [],
});

function renderPanel(
  initialDeposit?: { clientSecret: string | null; error: string | null },
  isWaitlist = false,
) {
  return render(
    <PaymentPanel
      bookingId="b-1"
      pricing={pricing}
      balanceDueLabel="1 November 2026"
      tripName="Brumski Christmas Trip"
      tripMeta="Alpe d'Huez"
      isWaitlist={isWaitlist}
      initialDeposit={initialDeposit}
    />,
  );
}

const SEEDED = { clientSecret: "pi_seeded_secret_abc", error: null };
const lastElementsSecret = () => {
  const last = h.elementsProps.at(-1) as { clientSecret?: string } | undefined;
  return last?.clientSecret ?? null;
};

beforeEach(() => {
  h.createPaymentIntent.mockReset();
  h.reconcilePayment.mockReset();
  h.push.mockReset();
  h.elementsProps.length = 0;
  h.createPaymentIntent.mockResolvedValue({
    ok: true,
    clientSecret: "pi_from_action_secret_xyz",
    amount: 15000,
  });
});
afterEach(cleanup);

describe("PaymentPanel: the server-seeded deposit intent", () => {
  it("mounts the card form from the seed without calling the action", async () => {
    renderPanel(SEEDED);

    expect(await screen.findByTestId("payment-element")).toBeTruthy();
    expect(lastElementsSecret()).toBe("pi_seeded_secret_abc");

    // Give the debounce window a chance to fire a request it should not fire.
    await new Promise((r) => setTimeout(r, 500));
    expect(h.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("shows the seeded error, with a retry, instead of a dead loading state", async () => {
    renderPanel({ clientSecret: null, error: "Couldn't reach our payment provider." });

    expect(await screen.findByText("Couldn't reach our payment provider.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByTestId("payment-element")).toBeNull();
    await new Promise((r) => setTimeout(r, 500));
    expect(h.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("fetches when Try again is pressed after a seeded failure", async () => {
    renderPanel({ clientSecret: null, error: "Couldn't reach our payment provider." });
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(h.createPaymentIntent).toHaveBeenCalledWith("b-1", "deposit"));
    expect(await screen.findByTestId("payment-element")).toBeTruthy();
    expect(lastElementsSecret()).toBe("pi_from_action_secret_xyz");
  });

  it("STILL fetches on a switch to pay-in-full - the seed must not suppress it", async () => {
    // The revenue bug this suite exists for: the seeded deposit secret is cancelled
    // server-side by this switch, so failing to re-request leaves no way to pay.
    renderPanel(SEEDED);
    expect(await screen.findByTestId("payment-element")).toBeTruthy();

    fireEvent.click(screen.getByText("Pay in full"));
    await waitFor(() => expect(h.createPaymentIntent).toHaveBeenCalledWith("b-1", "full"), {
      timeout: 2000,
    });
    await waitFor(() => expect(lastElementsSecret()).toBe("pi_from_action_secret_xyz"));
  });

  it("re-fetches on a switch BACK to deposit, because the seed is spent", async () => {
    renderPanel(SEEDED);
    expect(await screen.findByTestId("payment-element")).toBeTruthy();

    fireEvent.click(screen.getByText("Pay in full"));
    await waitFor(() => expect(h.createPaymentIntent).toHaveBeenCalledWith("b-1", "full"), {
      timeout: 2000,
    });

    fireEvent.click(screen.getByText("Pay deposit now"));
    await waitFor(
      () =>
        expect(
          h.createPaymentIntent.mock.calls.filter(([, mode]) => mode === "deposit"),
        ).toHaveLength(1),
      { timeout: 2000 },
    );
  });

  it("hides pay-in-full for a waiting-list booking and never asks for that amount", async () => {
    // A waitlister must not be charged the whole trip for a place they do not have
    // (audit #17). The seed is still the deposit, so nothing should be requested.
    renderPanel(SEEDED, true);
    expect(await screen.findByTestId("payment-element")).toBeTruthy();
    expect(screen.queryByText("Pay in full")).toBeNull();
    await new Promise((r) => setTimeout(r, 500));
    expect(h.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("falls back to fetching when no seed is supplied", async () => {
    // Keeps the panel usable if a caller ever renders it without the prop.
    renderPanel(undefined);
    await waitFor(() => expect(h.createPaymentIntent).toHaveBeenCalledWith("b-1", "deposit"));
    expect(await screen.findByTestId("payment-element")).toBeTruthy();
    expect(lastElementsSecret()).toBe("pi_from_action_secret_xyz");
  });
});
