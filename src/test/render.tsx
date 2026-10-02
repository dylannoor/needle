import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { TooltipProvider } from "../components/ui/tooltip";
import { NavProvider, type Screen } from "../lib/nav";
import { useBackendEvents } from "../lib/queries";

function Events() {
  useBackendEvents();
  return null;
}

/** Render with a fresh query cache, navigation and backend events, like the app shell. */
export function renderWithProviders(ui: ReactElement, { screen = "search" as Screen } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <NavProvider initial={screen}>
          <Events />
          {ui}
        </NavProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, client };
}
