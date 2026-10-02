import { useEffect, useRef } from "react";
import { startExtensionRuntime } from "./extensions-runtime";
import { Rail } from "./components/rail";
import { TooltipProvider } from "./components/ui/tooltip";
import { Logo } from "./components/ui/icons";
import { NavProvider, useNav, type Screen } from "./lib/nav";
import { useBackendEvents, useSession } from "./lib/queries";
import { LoginScreen } from "./screens/login";
import { SearchScreen } from "./screens/search";
import { TransfersScreen } from "./screens/transfers";
import { LibraryScreen } from "./screens/library";
import { RoomsScreen } from "./screens/rooms";
import { MessagesScreen } from "./screens/messages";
import { UsersScreen } from "./screens/users";
import { ExtensionsScreen } from "./screens/extensions";
import { SettingsScreen } from "./screens/settings";


const screens: Record<Screen, () => React.JSX.Element> = {
  search: SearchScreen,
  transfers: TransfersScreen,
  library: LibraryScreen,
  rooms: RoomsScreen,
  messages: MessagesScreen,
  users: UsersScreen,
  extensions: ExtensionsScreen,
  settings: SettingsScreen,
};

function Shell() {
  const { screen } = useNav();
  const Current = screens[screen];
  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <Rail />
      <Current />
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <span className="text-text">
        <Logo size={28} />
      </span>
      <span className="text-[13px]">{text}</span>
    </div>
  );
}

function initialScreen(): Screen {
  const s = new URLSearchParams(location.search).get("screen");
  return s && s in screens ? (s as Screen) : "search";
}

export function App() {
  useBackendEvents();
  const session = useSession();
  const online = session.data?.state === "online";
  const started = useRef(false);

  useEffect(() => {
    if (online && !started.current) {
      started.current = true;
      void startExtensionRuntime();
    }
  }, [online]);

  let content: React.JSX.Element;
  if (session.isPending) content = <Splash text="Starting Needle" />;
  else if (online) {
    content = (
      <NavProvider initial={initialScreen()}>
        <Shell />
      </NavProvider>
    );
  } else if (session.data?.state === "connecting" && session.data.remembered) content = <Splash text={`Connecting as ${session.data.username ?? "you"}`} />;
  else content = <LoginScreen status={session.data ?? null} />;

  return <TooltipProvider>{content}</TooltipProvider>;
}
