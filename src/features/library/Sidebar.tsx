import { invoke } from "@tauri-apps/api/core";
import { Creator } from "../../types/db";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Settings, DownloadCloud, Loader2, Search, Pin, GripVertical, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "../../lib/i18n";
import type { Translations } from "../../lib/i18n";

type FilterType = 'all' | 'free' | 'paid' | 'unsubscribed';

interface SidebarProps {
  creators: (Creator & { post_count: number })[];
  selectedCreatorId: string | null;
  onSelectCreator: (id: string | null) => void;
  onCreatorsUpdated: () => void;
  onDeleteCreator: (id: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenDownloads: () => void;
  downloadActiveCount: number;
  showStarred?: boolean;
  onSelectStarred?: () => void;
  syncingSubscriptions: boolean;
  subscriptionSyncStatus: string;
  onSyncSubscriptions: () => void;
  demoMode?: boolean;
}

function SortableCreatorItem({
  creator,
  selected,
  onSelect,
  onTogglePin,
  t,
}: {
  creator: Creator & { post_count: number };
  selected: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (creator: Creator & { post_count: number }) => void;
  t: Translations;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: creator.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      <div {...attributes} {...listeners} className="px-1 cursor-grab active:cursor-grabbing touch-none flex-shrink-0">
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      <ContextMenu>
        <ContextMenuTrigger className="flex-1 min-w-0">
          <Button
            variant={selected ? "secondary" : "ghost"}
            className="w-full justify-start h-auto py-2 px-2 min-w-0"
            onClick={() => onSelect(creator.id)}
          >
            <Pin className="h-3 w-3 text-muted-foreground flex-shrink-0 mr-1" />
            <Avatar className="h-6 w-6 mr-2 flex-shrink-0">
              <AvatarImage src={creator.avatar_path || undefined} />
              <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start truncate overflow-hidden text-left flex-1 min-w-0">
              <span className="text-sm truncate w-full">{creator.name}</span>
            </div>
            <span className="text-xs text-muted-foreground ml-auto pl-1">{creator.post_count}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onTogglePin(creator)}>{t.sidebar.unpin}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function CreatorItem({
  creator,
  selected,
  onSelect,
  onTogglePin,
  onDeleteCreator,
  filter,
  t,
}: {
  creator: Creator & { post_count: number };
  selected: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (creator: Creator & { post_count: number }) => void;
  onDeleteCreator: (creator: Creator & { post_count: number }) => void;
  filter: FilterType;
  t: Translations;
}) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Button
            variant={selected ? "secondary" : "ghost"}
            className="w-full justify-start h-auto py-2 px-2"
            onClick={() => onSelect(creator.id)}
          >
            <Avatar className="h-6 w-6 mr-2 flex-shrink-0">
              <AvatarImage src={creator.avatar_path || undefined} />
              <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start truncate overflow-hidden text-left flex-1">
              <span className="text-sm truncate w-full">{creator.name}</span>
              {filter === 'unsubscribed' && (
                <span className="text-xs text-muted-foreground">{t.sidebar.unsubscribedTag}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{creator.post_count}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onTogglePin(creator)}>{t.sidebar.pin}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            {t.sidebar.delete}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.sidebar.deleteConfirmTitle(creator.name)}</DialogTitle>
            <DialogDescription>
              {t.sidebar.deleteConfirmDesc}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => { setDeleteConfirmOpen(false); onDeleteCreator(creator); }}
            >
              {t.sidebar.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Sidebar({
  creators, selectedCreatorId, onSelectCreator, onCreatorsUpdated, onDeleteCreator, onOpenSettings,
  onOpenDownloads, downloadActiveCount,
  showStarred = false, onSelectStarred, syncingSubscriptions, subscriptionSyncStatus, onSyncSubscriptions,
  demoMode = false,
}: SidebarProps) {
  const t = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>('all');

  const handleTogglePin = async (creator: Creator & { post_count: number }) => {
    if (demoMode) return;
    await invoke('set_creator_pinned', { id: creator.id, pinned: !Boolean(creator.is_pinned) });
    onCreatorsUpdated();
  };

  const handleDeleteCreator = async (creator: Creator & { post_count: number }) => {
    await onDeleteCreator(creator.id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (demoMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const snapshot = [...pinnedCreators];
    const oldIndex = snapshot.findIndex(c => c.id === active.id);
    const newIndex = snapshot.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(snapshot, oldIndex, newIndex);
    await invoke('reorder_pinned_creators', { ids: reordered.map(c => c.id) });
    onCreatorsUpdated();
  };

  const filterCreators = (c: Creator & { post_count: number }) => {
    const subscribed = Boolean(c.is_subscribed);
    if (filter === 'all') return subscribed;
    if (filter === 'free') return subscribed && c.subscription_type === 'free';
    if (filter === 'paid') return subscribed && c.subscription_type === 'paid';
    if (filter === 'unsubscribed') return !subscribed;
    return false;
  };

  const FILTER_TABS: { key: FilterType; label: string }[] = [
    { key: 'all', label: t.sidebar.filterAll },
    { key: 'free', label: t.sidebar.filterFree },
    { key: 'paid', label: t.sidebar.filterPaid },
    { key: 'unsubscribed', label: t.sidebar.filterUnsubscribed },
  ];

  const visibleCreators = creators
    .filter(filterCreators)
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const pinnedCreators = visibleCreators
    .filter(c => Boolean(c.is_pinned))
    .sort((a, b) => a.pin_order - b.pin_order);

  const normalCreators = visibleCreators.filter(c => !Boolean(c.is_pinned));

  return (
    <div className="w-full bg-muted/30 flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <h1 className="font-semibold tracking-tight">PatreonBOX</h1>
        <Button variant="ghost" size="icon" title={t.sidebar.syncSubscriptionsTooltip} onClick={onSyncSubscriptions} disabled={syncingSubscriptions}>
          {syncingSubscriptions ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
        </Button>
      </div>

      {subscriptionSyncStatus && (
        <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50 border-b">
          {subscriptionSyncStatus}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t.sidebar.searchPlaceholder}
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-1 mb-1">
            {FILTER_TABS.map(tab => (
              <Button
                key={tab.key}
                variant={filter === tab.key ? "secondary" : "ghost"}
                className="flex-1 h-7 px-0 text-xs"
                onClick={() => { setFilter(tab.key); onSelectCreator(null); setSearch(""); }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <Button
            variant={showStarred ? "secondary" : "ghost"}
            className="w-full justify-start px-3 h-9 text-sm"
            onClick={() => { onSelectStarred?.(); setSearch(""); }}
          >
            <Star className={`h-4 w-4 mr-2 ${showStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
            {t.sidebar.starred}
          </Button>

          <Button
            variant={selectedCreatorId === null && !showStarred ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => onSelectCreator(null)}
          >
            {t.sidebar.allCreators}
          </Button>

          {pinnedCreators.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.sidebar.pinnedHeading(pinnedCreators.length)}
              </div>
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pinnedCreators.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {pinnedCreators.map(creator => (
                    <SortableCreatorItem
                      key={creator.id}
                      creator={creator}
                      selected={selectedCreatorId === creator.id}
                      onSelect={onSelectCreator}
                      onTogglePin={handleTogglePin}
                      t={t}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </>
          )}

          {normalCreators.length > 0 && (
            <div className="pt-4 pb-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.sidebar.subscriptionsHeading(normalCreators.length)}
            </div>
          )}

          {normalCreators.map(creator => (
            <CreatorItem
              key={creator.id}
              creator={creator}
              selected={selectedCreatorId === creator.id}
              onSelect={onSelectCreator}
              onTogglePin={handleTogglePin}
              onDeleteCreator={handleDeleteCreator}
              filter={filter}
              t={t}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t mt-auto space-y-1">
        <Button variant="ghost" className="w-full justify-start" onClick={onOpenDownloads}>
          <DownloadCloud className="mr-2 h-4 w-4" />
          {t.sidebar.downloads}
          {downloadActiveCount > 0 && (
            <span className="ml-auto text-xs font-semibold bg-primary text-primary-foreground rounded-full px-2 py-0.5 tabular-nums">
              {downloadActiveCount}
            </span>
          )}
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          {t.sidebar.settings}
        </Button>
      </div>
    </div>
  );
}
