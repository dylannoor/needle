import { useState } from "react";
import { Body, Screen, Spacer, TopBar } from "../../components/layout";
import { Search } from "../../components/ui/icons";
import { SearchField } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList } from "../../components/ui/tabs";
import { useNav } from "../../lib/nav";
import { BlockedLists } from "./blocked";
import { BrowseView } from "./browse";
import { BuddyList } from "./buddies";
import { InterestsView } from "./interests";
import { ProfileView } from "./profile";

export function UsersScreen() {
  const nav = useNav();
  const [lookup, setLookup] = useState("");
  const v = nav.usersView;

  return (
    <Screen>
      <TopBar>
        <h1 data-tauri-drag-region>Users &amp; buddies</h1>
        <Spacer />
        <form
          className="w-[320px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) nav.openUser(lookup.trim());
            setLookup("");
          }}
        >
          <SearchField label="Look up a user" placeholder="Look up any user" icon={<Search size={16} />} value={lookup} onChange={(e) => setLookup(e.target.value)} className="h-control" />
        </form>
      </TopBar>
      <Body>
        {v.kind === "profile" ? (
          <ProfileView key={v.username} username={v.username} />
        ) : v.kind === "browse" ? (
          <BrowseView key={v.username} username={v.username} />
        ) : (
          <Tabs value={v.kind} onValueChange={(k) => nav.setUsersView({ kind: k as "buddies" | "interests" | "blocked" })} className="flex min-w-0 grow flex-col px-7 pt-2">
            <TabsList
              items={[
                { value: "buddies", label: "Buddies" },
                { value: "interests", label: "Interests" },
                { value: "blocked", label: "Banned & ignored" },
              ]}
            />
            <TabsContent value="buddies" className="min-h-0 grow outline-none">
              <BuddyList />
            </TabsContent>
            <TabsContent value="interests" className="min-h-0 grow overflow-auto outline-none">
              <InterestsView />
            </TabsContent>
            <TabsContent value="blocked" className="min-h-0 grow overflow-auto outline-none">
              <BlockedLists />
            </TabsContent>
          </Tabs>
        )}
      </Body>
    </Screen>
  );
}
