import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { QualityProfile } from "../../bindings/QualityProfile";
import { Aside, Body, Screen, TopBar } from "../../components/layout";
import { Button } from "../../components/ui/button";
import { Chip } from "../../components/ui/chip";
import { StripToggle, TabStrip } from "../../components/tab-strip";
import { Select } from "../../components/ui/select";
import { Bar, GhostRows, InlineError } from "../../components/ui/states";
import { StatusDot } from "../../components/ui/status";
import { cn } from "../../lib/cn";
import { num, plural } from "../../lib/format";
import { api, errorText } from "../../lib/ipc";
import { useNav, type SearchTab } from "../../lib/nav";
import { keys, useProfiles, useSettings } from "../../lib/queries";
import { families, filterReleases, ownedKey } from "../../lib/releases";
import { ReleaseDetail } from "./release-detail";
import { ReleaseTable, releaseGrid } from "./release-table";
import { SearchBox } from "./search-box";
import { WishlistPanel } from "./wishlist";

export function SearchScreen() {
  const qc = useQueryClient();
  const nav = useNav();
  const settings = useSettings().data;
  const profiles = useProfiles().data ?? [];
  const history = useQuery({ queryKey: keys.history, queryFn: api.searchHistory }).data ?? [];
  const tab = nav.searchTabs.find((t) => t.id === nav.activeSearch) ?? null;
  const [query, setQuery] = useState(tab?.label ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState(false);
  const profileId = (tab ? tab.profileId : picked) ?? settings?.activeProfileId ?? null;

  const start = useMutation({
    mutationFn: (q: string) => api.searchStart(q.trim(), profileId),
    onSuccess: (id, q) => {
      nav.openSearch({ id, label: q.trim(), profileId, query: q.trim() });
      setWishlist(false);
      void qc.invalidateQueries({ queryKey: keys.history });
    },
  });
  const submit = (q: string) => {
    if (q.trim()) start.mutate(q);
  };

  return (
    <Screen>
      <TopBar>
        <SearchBox value={query} onChange={setQuery} onSubmit={submit} history={history} />
        {profiles.length > 0 && profileId && (
          <Select
            aria-label="Quality profile"
            prefix="Profile"
            value={profileId}
            onValueChange={(v) => {
              setPicked(v);
              if (tab) nav.setTabProfile(tab.id, v);
            }}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        <Button variant="primary" onClick={() => submit(query)} disabled={start.isPending}>
          Search
        </Button>
      </TopBar>

      <TabStrip
        label="Searches"
        tabs={nav.searchTabs}
        active={wishlist ? null : nav.activeSearch}
        onSelect={(id) => {
          nav.setActiveSearch(id);
          setQuery(nav.searchTabs.find((t) => t.id === id)?.label ?? "");
          setWishlist(false);
        }}
        onClose={(id) => {
          void api.searchCancel(id).catch(() => undefined);
          nav.closeSearch(id);
        }}
        trailing={
          <StripToggle pressed={wishlist} onClick={() => setWishlist(true)}>
            Wishlist
          </StripToggle>
        }
      />

      {start.isError && (
        <div className="px-7 pt-4">
          <InlineError message={errorText(start.error)} />
        </div>
      )}

      <Body>
        {wishlist ? (
          <WishlistPanel />
        ) : tab && profileId ? (
          <Results key={tab.id} tab={tab} profileId={profileId} profile={profiles.find((p) => p.id === profileId)} />
        ) : (
          <NoSearch />
        )}
      </Body>
    </Screen>
  );
}

function NoSearch() {
  return (
    <div className="flex min-w-0 grow flex-col p-4">
      <div className="h-[46px]" />
      <GhostRows
        count={7}
        label="Search for an artist or album. Results are grouped into releases and filtered by your quality profile."
        row={(i) => (
          <div className={cn(releaseGrid, "h-row")}>
            <Bar w={`${50 + ((i * 13) % 30)}%`} />
            <Bar w="70%" />
            <Bar w="60%" />
            <Bar w="80%" />
            <Bar w="70%" />
          </div>
        )}
      />
    </div>
  );
}

function Results({ tab, profileId, profile }: { tab: SearchTab; profileId: string; profile: QualityProfile | undefined }) {
  const [showHidden, setShowHidden] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [completeOnly, setCompleteOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nav = useNav();
  // The backend keeps the last 20 searches; an older tab has to run again.
  const rerun = useMutation({
    mutationFn: () => {
      const s = tab.scope;
      return s && "user" in s ? api.searchUser(s.user, tab.query) : s && "room" in s ? api.searchRoom(s.room, tab.query) : api.searchStart(tab.query, profileId);
    },
    onSuccess: (id) => nav.replaceSearch(tab.id, { ...tab, id }),
  });
  const view = useQuery({
    queryKey: keys.searchView(tab.id, profileId, showHidden),
    queryFn: () => api.searchView(tab.id, profileId, showHidden),
    placeholderData: (prev) => prev,
  });
  const data = view.data;
  const releases = data?.releases ?? [];
  const fams = families(releases);
  const filtered = filterReleases(releases, { off, completeOnly });
  const hidden = data?.hiddenReleases ?? [];

  const all = [...releases, ...hidden];
  const paths = all.map(ownedKey);
  const owned = useQuery({ queryKey: keys.owned(paths), queryFn: () => api.ownedCheck(paths), enabled: paths.length > 0, staleTime: 60_000 });
  const ownedIds = new Set(all.filter((_, i) => owned.data?.[i]).map((r) => r.id));

  const selected = all.find((r) => r.id === selectedId) ?? filtered[0] ?? null;
  const hiddenFiles = data ? data.hidden.belowProfile + data.hidden.queueTooLong + data.hidden.notAudio : 0;

  if (view.isError && !data) {
    return (
      <div className="grow p-7">
        <InlineError message={errorText(view.error)} onRetry={() => rerun.mutate()} retryLabel="Search again" />
        {rerun.isError && <div className="pt-3"><InlineError message={errorText(rerun.error)} /></div>}
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 grow flex-col p-4">
        <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 px-3 pb-3.5">
          {data && !data.done && <StatusDot tone="busy" className="mr-1" />}
          <span className="font-semibold">{plural(releases.length, "release")}</span>
          <span className="text-muted">{data && !data.done ? `so far from ${plural(data.totalPeers, "user")}.` : "match your profile."}</span>
          {hiddenFiles > 0 && (
            <button type="button" className="link ml-0.5 text-muted" aria-pressed={showHidden} onClick={() => setShowHidden((s) => !s)}>
              {showHidden ? "Hide the hidden files" : `Show ${num(hiddenFiles)} hidden files`}
            </button>
          )}
          <div className="grow" />
          {fams.map((f) => (
            <Chip
              key={f}
              pressed={!off.has(f)}
              onPressedChange={(on) =>
                setOff((o) => {
                  const n = new Set(o);
                  if (on) n.delete(f);
                  else n.add(f);
                  return n;
                })
              }
            >
              {f}
            </Chip>
          ))}
          <Chip pressed={completeOnly} onPressedChange={setCompleteOnly}>
            Complete only
          </Chip>
        </div>
        <ReleaseTable
          releases={filtered}
          hidden={hidden}
          showHidden={showHidden}
          owned={ownedIds}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          profile={profile}
          loading={view.isPending}
          emptyLabel={
            releases.length
              ? "No releases left with these filters"
              : data?.done
                ? hiddenFiles
                  ? "Nothing matches your profile. Show the hidden files to see what was found."
                  : "Nobody has this right now. Add it to the wishlist and Needle keeps looking."
                : "Waiting for results"
          }
        />
      </div>
      <Aside label="Selected release">{selected ? <ReleaseDetail key={selected.id} searchId={tab.id} release={selected} /> : <DetailGhost />}</Aside>
    </>
  );
}

function DetailGhost() {
  return (
    <GhostRows
      className="px-7 py-6"
      count={9}
      label="Select a release to see its tracks"
      row={(i) => (
        <div className="py-2.5">
          <Bar w={i === 0 ? "55%" : `${40 + ((i * 17) % 45)}%`} className={i === 0 ? "h-4" : undefined} />
        </div>
      )}
    />
  );
}
